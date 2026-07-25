import io
import json
import math
import os
import tempfile

from typing import Any
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import plotly
import plotly.graph_objects as go
import pyreadstat
import pytesseract
import scipy
import scipy.stats as stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from statsmodels.duration.survfunc import SurvfuncRight

from dotenv import load_dotenv

# Automatically load environment configuration from backend/.env if present
env_file = Path(__file__).parent.parent.parent / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

from .clinical_validation import validate_clinical_parameters
from .knowledge_catalog import (
    STUDY_TYPE_LABELS,
    VALID_STUDY_TYPES,
    get_catalog_summary,
    get_references_for_study_type,
    is_valid_study_type,
)
from .privacy import PHI_AUDIT_LOGS, redact_phi, redact_phi_with_audit
from .prompt_library import build_system_prompt
from .rag_engine import rag_engine
from .sample_size_engine import calculate_sample_size


app = FastAPI(title="ClinResearch Analytics Service", version="1.0.0")


def compute_cohens_d(g1: np.ndarray, g2: np.ndarray) -> float | None:
    n1, n2 = len(g1), len(g2)
    if n1 < 2 or n2 < 2:
        return None
    s1, s2 = float(np.std(g1, ddof=1)), float(np.std(g2, ddof=1))
    s_pooled = math.sqrt(((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2))
    return float((np.mean(g1) - np.mean(g2)) / s_pooled) if s_pooled > 0 else 0.0


def compute_normality_shapiro(data: np.ndarray) -> dict[str, Any] | None:
    if len(data) < 3:
        return None
    try:
        stat, p_val = stats.shapiro(data[:5000])
        return {"statistic": float(stat), "pValue": float(p_val), "isNormal": bool(p_val > 0.05)}
    except Exception:
        return None


def compute_levene_test(groups: list[np.ndarray]) -> dict[str, Any] | None:
    if len(groups) < 2 or any(len(g) < 2 for g in groups):
        return None
    try:
        stat, p_val = stats.levene(*groups)
        return {"statistic": float(stat), "pValue": float(p_val), "equalVariance": bool(p_val > 0.05)}
    except Exception:
        return None


def compute_mean_ci(g1: np.ndarray, g2: np.ndarray, confidence: float = 0.95) -> dict[str, float] | None:
    n1, n2 = len(g1), len(g2)
    if n1 < 2 or n2 < 2:
        return None
    diff = float(np.mean(g1) - np.mean(g2))
    se = float(math.sqrt(np.var(g1, ddof=1) / n1 + np.var(g2, ddof=1) / n2))
    margin = float(stats.norm.ppf(1.0 - (1.0 - confidence) / 2.0) * se)
    return {"meanDifference": diff, "ciLower": diff - margin, "ciUpper": diff + margin}



def configure_tesseract_path() -> str | None:
    candidates = [
        os.getenv("TESSERACT_CMD"),
        r"D:\RESAERCH\tools\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.join(os.getenv("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            pytesseract.pytesseract.tesseract_cmd = candidate
            return candidate

    return None


configured_tesseract_cmd = configure_tesseract_path()


class AssistantRequest(BaseModel):
    mode: str = Field(default="researcher_response")
    prompt: str = Field(default="")
    protocol_text: str | None = None
    study_type: str | None = None
    dataset_profile: dict[str, Any] | None = None
    statistical_result: dict[str, Any] | None = None
    study_context: dict[str, Any] | None = None


def to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
            return None
        return value
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    if hasattr(value, "tolist"):
        return value.tolist()
    return str(value)


def load_dataframe(file_name: str, file_bytes: bytes) -> pd.DataFrame:
    suffix = os.path.splitext(file_name.lower())[1]

    if suffix == ".csv":
        return pd.read_csv(io.BytesIO(file_bytes))
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(io.BytesIO(file_bytes))
    if suffix == ".sav":
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_path = temp_file.name
        try:
            dataframe, _meta = pyreadstat.read_sav(temp_path)
            return dataframe
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")


def clean_dataframe(dataframe: pd.DataFrame, options: dict[str, Any]) -> pd.DataFrame:
    frame = dataframe.copy()
    frame = frame.replace({np.inf: np.nan, -np.inf: np.nan})

    if options.get("trim_whitespace", True):
        object_columns = frame.select_dtypes(include=["object"]).columns
        for column in object_columns:
            frame[column] = frame[column].apply(lambda value: value.strip() if isinstance(value, str) else value)

    if options.get("drop_empty_columns", False):
        frame = frame.dropna(axis=1, how="all")

    fill_strategy = options.get("fill_missing")
    if fill_strategy in {"mean", "median"}:
        numeric_columns = frame.select_dtypes(include=["number"]).columns
        for column in numeric_columns:
            if fill_strategy == "mean":
                frame[column] = frame[column].fillna(frame[column].mean())
            else:
                frame[column] = frame[column].fillna(frame[column].median())

    if options.get("drop_missing_rows", False):
        frame = frame.dropna()

    return frame


def dataframe_profile(dataframe: pd.DataFrame) -> dict[str, Any]:
    missing = dataframe.isna().sum().sort_values(ascending=False)
    missing = missing[missing > 0]
    numeric_columns = dataframe.select_dtypes(include=["number"]).columns.tolist()
    categorical_columns = dataframe.select_dtypes(exclude=["number"]).columns.tolist()

    column_details = []
    for column in dataframe.columns:
        series = dataframe[column]
        detail = {
            "name": column,
            "dtype": str(series.dtype),
            "missing": int(series.isna().sum()),
            "unique": int(series.nunique(dropna=True)),
        }
        if pd.api.types.is_numeric_dtype(series):
            detail["mean"] = to_jsonable(series.mean())
            detail["std"] = to_jsonable(series.std())
            detail["min"] = to_jsonable(series.min())
            detail["max"] = to_jsonable(series.max())
        else:
            detail["top_values"] = to_jsonable(series.value_counts(dropna=True).head(5).to_dict())
        column_details.append(detail)

    suggestions = []
    if numeric_columns:
        suggestions.append("Dataset contains numeric variables suitable for t-tests, ANOVA, regression, and survival-ready preprocessing.")
    if categorical_columns:
        suggestions.append("Dataset contains categorical variables suitable for chi-square, logistic regression, and grouped visualizations.")
    if len(missing) > 0:
        suggestions.append("Missing values detected. Consider imputation or complete-case analysis before final inference.")

    return {
        "rows": int(len(dataframe)),
        "columns": int(len(dataframe.columns)),
        "columnNames": dataframe.columns.tolist(),
        "numericColumns": numeric_columns,
        "categoricalColumns": categorical_columns,
        "missingValues": to_jsonable(missing.to_dict()),
        "missingRate": to_jsonable((dataframe.isna().mean() * 100).round(2).to_dict()),
        "preview": to_jsonable(dataframe.head(10).replace({np.nan: None}).to_dict(orient="records")),
        "columnDetails": column_details,
        "suggestions": suggestions,
    }


def get_profile_column_details(config: dict[str, Any], column_name: str | None) -> dict[str, Any] | None:
    if not column_name:
        return None

    profile = config.get("dataset_profile") or {}
    column_details = profile.get("columnDetails") or []
    if isinstance(column_details, list):
        for detail in column_details:
            if isinstance(detail, dict) and detail.get("name") == column_name:
                return detail
    return None


def is_numeric_column_from_profile(config: dict[str, Any], column_name: str | None) -> bool:
    detail = get_profile_column_details(config, column_name)
    if not detail:
        return False
    return "int" in str(detail.get("dtype", "")).lower() or "float" in str(detail.get("dtype", "")).lower()


def get_unique_count_from_profile(config: dict[str, Any], column_name: str | None) -> int | None:
    detail = get_profile_column_details(config, column_name)
    if not detail:
        return None
    unique_count = detail.get("unique")
    return int(unique_count) if isinstance(unique_count, (int, float)) else None


def choose_statistical_test(config: dict[str, Any]) -> dict[str, Any]:
    if config.get("analysis_type") and config["analysis_type"] != "auto":
        return {"recommended_test": config["analysis_type"], "reason": "Explicit analysis type was supplied by the client."}

    if (
        config.get("paired")
        and config.get("x_column")
        and config.get("y_column")
        and is_numeric_column_from_profile(config, config.get("x_column"))
        and is_numeric_column_from_profile(config, config.get("y_column"))
    ):
        return {"recommended_test": "paired_t_test", "reason": "Two paired numeric measurements were provided."}

    if config.get("time_column") and config.get("event_column"):
        return {"recommended_test": "survival_analysis", "reason": "Time-to-event inputs were provided."}

    if config.get("score_column") and config.get("truth_column"):
        return {"recommended_test": "roc_curve", "reason": "Score and truth columns fit ROC analysis."}

    if (
        config.get("dependent_column")
        and config.get("covariates")
        and config.get("group_column")
        and is_numeric_column_from_profile(config, config.get("dependent_column"))
    ):
        return {"recommended_test": "ancova", "reason": "Outcome plus group and covariates suggest ANCOVA."}

    if config.get("dependent_column") and (
        config.get("binary_target") or (get_unique_count_from_profile(config, config.get("dependent_column")) == 2)
    ):
        return {"recommended_test": "logistic_regression", "reason": "Binary target selected for regression."}

    if (
        config.get("dependent_column")
        and config.get("independent_columns")
        and is_numeric_column_from_profile(config, config.get("dependent_column"))
    ):
        return {"recommended_test": "linear_regression", "reason": "Continuous outcome plus predictors suggest linear regression."}

    derived_group_count = config.get("group_count") or get_unique_count_from_profile(config, config.get("group_column")) or 0

    if (
        config.get("group_column")
        and config.get("value_column")
        and is_numeric_column_from_profile(config, config.get("value_column"))
        and derived_group_count > 2
    ):
        return {"recommended_test": "anova", "reason": "Continuous outcome with more than two groups suggests ANOVA."}

    if (
        config.get("group_column")
        and config.get("value_column")
        and is_numeric_column_from_profile(config, config.get("value_column"))
        and derived_group_count == 2
    ):
        return {"recommended_test": "independent_t_test", "reason": "Continuous outcome with two groups suggests an independent t-test."}

    if (
        config.get("paired")
        and config.get("x_column")
        and config.get("y_column")
    ):
        return {"recommended_test": "wilcoxon", "reason": "Paired inputs were supplied but at least one paired variable is not clearly numeric."}

    if (
        config.get("x_column")
        and config.get("y_column")
        and not is_numeric_column_from_profile(config, config.get("x_column"))
        and not is_numeric_column_from_profile(config, config.get("y_column"))
    ):
        return {"recommended_test": "chi_square", "reason": "Two categorical columns suggest chi-square."}

    return {"recommended_test": "dataset_profile", "reason": "Insufficient structure for inferential testing; profile the dataset first."}


def validate_columns(dataframe: pd.DataFrame, columns: list[str]) -> None:
    missing_columns = [column for column in columns if column and column not in dataframe.columns]
    if missing_columns:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_columns)}")


def ensure_numeric_columns(dataframe: pd.DataFrame, columns: list[str], context: str) -> None:
    invalid_columns = [column for column in columns if column and not pd.api.types.is_numeric_dtype(dataframe[column])]
    if invalid_columns:
        raise HTTPException(
            status_code=400,
            detail=f"{context} requires numeric columns. Invalid columns: {', '.join(invalid_columns)}",
        )


def ensure_categorical_columns(dataframe: pd.DataFrame, columns: list[str], context: str) -> None:
    invalid_columns = [column for column in columns if column and pd.api.types.is_numeric_dtype(dataframe[column])]
    if invalid_columns:
        raise HTTPException(
            status_code=400,
            detail=f"{context} requires categorical columns. Invalid columns: {', '.join(invalid_columns)}",
        )


def ensure_binary_column(dataframe: pd.DataFrame, column: str, context: str) -> None:
    unique_values = dataframe[column].dropna().nunique()
    if unique_values != 2:
        raise HTTPException(status_code=400, detail=f"{context} requires a binary column: {column}")


def build_plotly_response(figure: go.Figure | None) -> dict[str, Any] | None:
    if figure is None:
        return None
    figure.update_layout(template="plotly_white", margin=dict(l=40, r=20, t=40, b=40))
    return to_jsonable(figure.to_dict())


def run_independent_t_test(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    group_column = config["group_column"]
    value_column = config["value_column"]
    validate_columns(dataframe, [group_column, value_column])
    ensure_categorical_columns(dataframe, [group_column], "Independent t-test")
    ensure_numeric_columns(dataframe, [value_column], "Independent t-test")

    groups = [group.dropna().astype(float).to_numpy() for _name, group in dataframe.groupby(group_column)[value_column]]
    labels = dataframe[group_column].dropna().unique().tolist()
    if len(groups) != 2:
        raise HTTPException(status_code=400, detail="Independent t-test requires exactly two groups.")

    statistic, p_value = stats.ttest_ind(groups[0], groups[1], equal_var=config.get("equal_var", False), nan_policy="omit")
    cohens_d = compute_cohens_d(groups[0], groups[1])
    normality = {str(labels[0]): compute_normality_shapiro(groups[0]), str(labels[1]): compute_normality_shapiro(groups[1])}
    levene_test = compute_levene_test(groups)
    ci_95 = compute_mean_ci(groups[0], groups[1])

    figure = go.Figure()
    for label, values in zip(labels, groups):
        figure.add_trace(go.Box(y=values, name=str(label)))

    return {
        "analysis": "independent_t_test",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "effectSize": to_jsonable(cohens_d),
        "effectSizeLabel": "Cohen's d",
        "confidenceInterval": to_jsonable(ci_95),
        "normalityCheck": to_jsonable(normality),
        "varianceHomogeneityCheck": to_jsonable(levene_test),
        "groupLabels": labels,
        "groupMeans": to_jsonable({str(label): float(np.mean(values)) for label, values in zip(labels, groups)}),
        "figure": build_plotly_response(figure),
    }


def run_paired_t_test(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    x_column = config["x_column"]
    y_column = config["y_column"]
    validate_columns(dataframe, [x_column, y_column])
    ensure_numeric_columns(dataframe, [x_column, y_column], "Paired t-test")
    subset = dataframe[[x_column, y_column]].dropna().astype(float)
    g1 = subset[x_column].to_numpy()
    g2 = subset[y_column].to_numpy()

    statistic, p_value = stats.ttest_rel(g1, g2, nan_policy="omit")
    diff = g1 - g2
    cohens_d = float(np.mean(diff) / np.std(diff, ddof=1)) if np.std(diff, ddof=1) > 0 else 0.0
    normality = {x_column: compute_normality_shapiro(g1), y_column: compute_normality_shapiro(g2), "differences": compute_normality_shapiro(diff)}
    ci_95 = compute_mean_ci(g1, g2)

    figure = go.Figure()
    figure.add_trace(go.Box(y=g1, name=x_column))
    figure.add_trace(go.Box(y=g2, name=y_column))
    return {
        "analysis": "paired_t_test",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "effectSize": to_jsonable(cohens_d),
        "effectSizeLabel": "Cohen's d (paired)",
        "confidenceInterval": to_jsonable(ci_95),
        "normalityCheck": to_jsonable(normality),
        "sampleSize": int(len(subset)),
        "means": to_jsonable({x_column: float(np.mean(g1)), y_column: float(np.mean(g2))}),
        "figure": build_plotly_response(figure),
    }



def run_chi_square(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    x_column = config["x_column"]
    y_column = config["y_column"]
    validate_columns(dataframe, [x_column, y_column])
    ensure_categorical_columns(dataframe, [x_column, y_column], "Chi-square")
    contingency = pd.crosstab(dataframe[x_column], dataframe[y_column])
    statistic, p_value, dof, expected = stats.chi2_contingency(contingency)
    heatmap = go.Figure(data=go.Heatmap(z=contingency.values, x=contingency.columns.tolist(), y=contingency.index.tolist()))
    return {
        "analysis": "chi_square",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "degreesOfFreedom": int(dof),
        "contingencyTable": to_jsonable(contingency.to_dict()),
        "expected": to_jsonable(expected),
        "figure": build_plotly_response(heatmap),
    }


def run_mann_whitney(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    group_column = config["group_column"]
    value_column = config["value_column"]
    validate_columns(dataframe, [group_column, value_column])
    ensure_categorical_columns(dataframe, [group_column], "Mann-Whitney")
    ensure_numeric_columns(dataframe, [value_column], "Mann-Whitney")
    groups = [group.dropna().astype(float) for _name, group in dataframe.groupby(group_column)[value_column]]
    labels = dataframe[group_column].dropna().unique().tolist()
    if len(groups) != 2:
        raise HTTPException(status_code=400, detail="Mann-Whitney requires exactly two groups.")
    statistic, p_value = stats.mannwhitneyu(groups[0], groups[1], alternative=config.get("alternative", "two-sided"))
    figure = go.Figure()
    for label, values in zip(labels, groups):
        figure.add_trace(go.Box(y=values, name=str(label)))
    return {
        "analysis": "mann_whitney",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "groupLabels": labels,
        "figure": build_plotly_response(figure),
    }


def run_wilcoxon(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    x_column = config["x_column"]
    y_column = config["y_column"]
    validate_columns(dataframe, [x_column, y_column])
    ensure_numeric_columns(dataframe, [x_column, y_column], "Wilcoxon")
    subset = dataframe[[x_column, y_column]].dropna().astype(float)
    statistic, p_value = stats.wilcoxon(subset[x_column], subset[y_column], alternative=config.get("alternative", "two-sided"))
    figure = go.Figure()
    figure.add_trace(go.Box(y=subset[x_column], name=x_column))
    figure.add_trace(go.Box(y=subset[y_column], name=y_column))
    return {
        "analysis": "wilcoxon",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "sampleSize": int(len(subset)),
        "figure": build_plotly_response(figure),
    }


def run_linear_regression(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    dependent = config["dependent_column"]
    predictors = config["independent_columns"]
    validate_columns(dataframe, [dependent, *predictors])
    ensure_numeric_columns(dataframe, [dependent], "Linear regression")
    formula = f"{dependent} ~ {' + '.join(predictors)}"
    model = smf.ols(formula=formula, data=dataframe.dropna(subset=[dependent, *predictors])).fit()
    return {
        "analysis": "linear_regression",
        "formula": formula,
        "rSquared": to_jsonable(model.rsquared),
        "adjustedRSquared": to_jsonable(model.rsquared_adj),
        "pValues": to_jsonable(model.pvalues.to_dict()),
        "coefficients": to_jsonable(model.params.to_dict()),
        "summaryText": model.summary().as_text(),
    }


def run_logistic_regression(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    dependent = config["dependent_column"]
    predictors = config["independent_columns"]
    validate_columns(dataframe, [dependent, *predictors])
    ensure_binary_column(dataframe, dependent, "Logistic regression")
    formula = f"{dependent} ~ {' + '.join(predictors)}"
    model = smf.logit(formula=formula, data=dataframe.dropna(subset=[dependent, *predictors])).fit(disp=False)
    return {
        "analysis": "logistic_regression",
        "formula": formula,
        "pseudoRSquared": to_jsonable(model.prsquared),
        "pValues": to_jsonable(model.pvalues.to_dict()),
        "coefficients": to_jsonable(model.params.to_dict()),
        "oddsRatios": to_jsonable(np.exp(model.params).to_dict()),
        "summaryText": model.summary().as_text(),
    }


def run_anova(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    dependent = config["dependent_column"]
    group = config["group_column"]
    validate_columns(dataframe, [dependent, group])
    ensure_numeric_columns(dataframe, [dependent], "ANOVA")
    ensure_categorical_columns(dataframe, [group], "ANOVA")
    formula = f"{dependent} ~ C({group})"
    model = smf.ols(formula=formula, data=dataframe.dropna(subset=[dependent, group])).fit()
    anova_table = sm.stats.anova_lm(model, typ=2)
    figure = go.Figure()
    for name, values in dataframe[[group, dependent]].dropna().groupby(group)[dependent]:
        figure.add_trace(go.Box(y=values, name=str(name)))
    return {
        "analysis": "anova",
        "formula": formula,
        "anovaTable": to_jsonable(anova_table.reset_index().to_dict(orient="records")),
        "summaryText": model.summary().as_text(),
        "figure": build_plotly_response(figure),
    }


def run_ancova(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    dependent = config["dependent_column"]
    group = config["group_column"]
    covariates = config.get("covariates", [])
    validate_columns(dataframe, [dependent, group, *covariates])
    ensure_numeric_columns(dataframe, [dependent, *covariates], "ANCOVA")
    ensure_categorical_columns(dataframe, [group], "ANCOVA")
    covariate_formula = " + ".join(covariates)
    formula = f"{dependent} ~ C({group})" + (f" + {covariate_formula}" if covariate_formula else "")
    model = smf.ols(formula=formula, data=dataframe.dropna(subset=[dependent, group, *covariates])).fit()
    anova_table = sm.stats.anova_lm(model, typ=2)
    return {
        "analysis": "ancova",
        "formula": formula,
        "anovaTable": to_jsonable(anova_table.reset_index().to_dict(orient="records")),
        "summaryText": model.summary().as_text(),
    }


def run_survival_analysis(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    time_column = config["time_column"]
    event_column = config["event_column"]
    group_column = config.get("group_column")
    validate_columns(dataframe, [time_column, event_column] + ([group_column] if group_column else []))
    ensure_numeric_columns(dataframe, [time_column], "Survival analysis")
    ensure_binary_column(dataframe, event_column, "Survival analysis")
    subset_columns = [time_column, event_column] + ([group_column] if group_column else [])
    subset = dataframe[subset_columns].dropna()
    figure = go.Figure()

    if group_column:
        groups_summary = {}
        for group_name, group_frame in subset.groupby(group_column):
            surv = SurvfuncRight(group_frame[time_column], group_frame[event_column])
            figure.add_trace(go.Scatter(x=surv.surv_times, y=surv.surv_prob, mode="lines", name=str(group_name)))
            groups_summary[str(group_name)] = {
                "events": int(np.sum(group_frame[event_column])),
                "sampleSize": int(len(group_frame)),
            }
    else:
        surv = SurvfuncRight(subset[time_column], subset[event_column])
        figure.add_trace(go.Scatter(x=surv.surv_times, y=surv.surv_prob, mode="lines", name="Overall"))
        groups_summary = {"Overall": {"events": int(np.sum(subset[event_column])), "sampleSize": int(len(subset))}}

    figure.update_layout(title="Kaplan-Meier Survival Curve", xaxis_title=time_column, yaxis_title="Survival Probability")
    return {
        "analysis": "survival_analysis",
        "groups": groups_summary,
        "figure": build_plotly_response(figure),
    }


def compute_roc_curve(truth: np.ndarray, scores: np.ndarray) -> dict[str, Any]:
    thresholds = np.unique(scores)[::-1]
    tpr_values = [0.0]
    fpr_values = [0.0]
    for threshold in thresholds:
        predictions = scores >= threshold
        tp = np.sum((predictions == 1) & (truth == 1))
        fp = np.sum((predictions == 1) & (truth == 0))
        fn = np.sum((predictions == 0) & (truth == 1))
        tn = np.sum((predictions == 0) & (truth == 0))
        tpr = tp / (tp + fn) if (tp + fn) else 0.0
        fpr = fp / (fp + tn) if (fp + tn) else 0.0
        tpr_values.append(float(tpr))
        fpr_values.append(float(fpr))
    tpr_values.append(1.0)
    fpr_values.append(1.0)
    auc = float(np.trapz(sorted(tpr_values), sorted(fpr_values)))
    return {"fpr": fpr_values, "tpr": tpr_values, "auc": auc}


def run_roc_curve(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    truth_column = config["truth_column"]
    score_column = config["score_column"]
    validate_columns(dataframe, [truth_column, score_column])
    ensure_binary_column(dataframe, truth_column, "ROC curve")
    ensure_numeric_columns(dataframe, [score_column], "ROC curve")
    subset = dataframe[[truth_column, score_column]].dropna().astype(float)
    roc = compute_roc_curve(subset[truth_column].to_numpy(), subset[score_column].to_numpy())
    figure = go.Figure()
    figure.add_trace(go.Scatter(x=roc["fpr"], y=roc["tpr"], mode="lines", name="ROC"))
    figure.add_trace(go.Scatter(x=[0, 1], y=[0, 1], mode="lines", name="Chance", line=dict(dash="dash")))
    figure.update_layout(title="ROC Curve", xaxis_title="False Positive Rate", yaxis_title="True Positive Rate")
    return {
        "analysis": "roc_curve",
        "auc": roc["auc"],
        "figure": build_plotly_response(figure),
    }


def run_visualization(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    chart_type = config.get("chart_type", "histogram")
    x_column = config.get("x_column")
    y_column = config.get("y_column")
    color_column = config.get("group_column")

    validate_columns(dataframe, [column for column in [x_column, y_column, color_column] if column])

    figure = go.Figure()
    if chart_type == "histogram" and x_column:
        figure.add_trace(go.Histogram(x=dataframe[x_column].dropna(), name=x_column))
    elif chart_type == "box_plot" and y_column:
        if color_column:
            for name, group in dataframe[[color_column, y_column]].dropna().groupby(color_column)[y_column]:
                figure.add_trace(go.Box(y=group, name=str(name)))
        else:
            figure.add_trace(go.Box(y=dataframe[y_column].dropna(), name=y_column))
    elif chart_type == "scatter" and x_column and y_column:
        figure.add_trace(go.Scatter(x=dataframe[x_column], y=dataframe[y_column], mode="markers"))
    else:
        raise HTTPException(status_code=400, detail="Unsupported chart configuration.")

    figure.update_layout(title=chart_type.replace("_", " ").title())
    return {
        "analysis": "visualization",
        "chartType": chart_type,
        "figure": build_plotly_response(figure),
    }


def run_analysis_dispatch(dataframe: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    analysis_type = choose_statistical_test(config)["recommended_test"] if config.get("analysis_type", "auto") == "auto" else config.get("analysis_type")

    dispatch_map = {
        "independent_t_test": run_independent_t_test,
        "paired_t_test": run_paired_t_test,
        "chi_square": run_chi_square,
        "mann_whitney": run_mann_whitney,
        "wilcoxon": run_wilcoxon,
        "linear_regression": run_linear_regression,
        "logistic_regression": run_logistic_regression,
        "anova": run_anova,
        "ancova": run_ancova,
        "survival_analysis": run_survival_analysis,
        "roc_curve": run_roc_curve,
        "visualization": run_visualization,
        "dataset_profile": lambda frame, _config: {"analysis": "dataset_profile", "profile": dataframe_profile(frame)},
    }

    handler = dispatch_map.get(analysis_type)
    if not handler:
        raise HTTPException(status_code=400, detail=f"Unsupported analysis type: {analysis_type}")

    result = handler(dataframe, config)
    result["recommended"] = choose_statistical_test(config)
    return result


def extract_study_elements(protocol_text: str) -> dict[str, Any]:
    lines = [line.strip("- ").strip() for line in protocol_text.splitlines() if line.strip()]
    short_text = " ".join(lines)
    return {
        "title": lines[0] if lines else "Untitled protocol",
        "objective": lines[1] if len(lines) > 1 else short_text[:180],
        "keyElements": lines[:8],
        "studyTypeGuess": "supervised clinical study" if "supervisor" in short_text.lower() else "clinical research study",
    }


def get_knowledge_context(request: AssistantRequest) -> dict[str, Any]:
    study_context = request.study_context or {}
    knowledge_context = study_context.get("knowledge_context")
    return knowledge_context if isinstance(knowledge_context, dict) else {}


def build_knowledge_evidence_lines(request: AssistantRequest) -> list[str]:
    knowledge_context = get_knowledge_context(request)
    answer = knowledge_context.get("answer")
    citations = knowledge_context.get("citations") if isinstance(knowledge_context.get("citations"), list) else []

    sections: list[str] = []
    if isinstance(answer, str) and answer.strip():
        sections.append("خلاصة مرجعية من المكتبة المعرفية:")
        sections.append(answer.strip())

    if citations:
        sections.append("الاستشهادات المرجعية المتاحة:")
        for citation in citations[:4]:
            if not isinstance(citation, dict):
                continue
            source_file = str(citation.get("source_file") or "Unknown source")
            page = citation.get("page")
            section = citation.get("section")
            parts = [source_file]
            if page not in (None, ""):
                parts.append(f"p.{page}")
            if section:
                parts.append(str(section))
            sections.append(f"- {' | '.join(parts)}")

    return sections


def build_fallback_assistant_response(request: AssistantRequest) -> dict[str, Any]:
    mode = request.mode
    profile = request.dataset_profile or {}
    stats_result = request.statistical_result or {}
    protocol_text = request.protocol_text or request.prompt
    extracted = extract_study_elements(protocol_text) if protocol_text else None

    sections = build_knowledge_evidence_lines(request)
    if mode == "protocol_understanding" and extracted:
        sections.append(f"عنوان مقترح البروتوكول: {extracted['title']}")
        sections.append(f"العنصر الأبرز: {extracted['objective']}")
        sections.append("تم استخراج العناصر الأولية للدراسة ويمكن الآن توليد هيكل الدراسة أو اختيار التحليل المناسب.")
    elif mode == "study_elements" and extracted:
        sections.append("تم استخراج عناصر الدراسة الرئيسية.")
        sections.extend([f"- {item}" for item in extracted["keyElements"]])
    elif mode == "analysis_selection":
        recommendation = stats_result.get("recommended") or choose_statistical_test(request.study_context or {})
        sections.append(f"الاختبار/التحليل المقترح: {recommendation.get('recommended_test', 'غير محدد')}")
        sections.append(f"السبب: {recommendation.get('reason', 'لا توجد معطيات كافية')}")
    elif mode == "results_explanation":
        sections.append("تم إنشاء شرح مبدئي للنتائج بناءً على المخرجات الحسابية الفعلية.")
        if "pValue" in stats_result:
            sections.append(f"P-value: {stats_result['pValue']}")
        if "analysis" in stats_result:
            sections.append(f"التحليل: {stats_result['analysis']}")
    elif mode == "final_report":
        sections.append("تم تجهيز مسودة تقرير نهائي تعتمد على ملف الدراسة ونتائج التحليل والملخص الإحصائي.")
        if profile:
            sections.append(f"حجم البيانات: {profile.get('rows', 0)} صف و{profile.get('columns', 0)} عمود.")
    else:
        sections.append("تمت معالجة طلب الباحث بنمط رد آمن قائم على البيانات والنتائج المتاحة.")
        if request.prompt:
            sections.append(f"ملخص الطلب: {request.prompt[:300]}")

    audit_prompt_info = redact_phi_with_audit(request.prompt)
    return {
        "answer": "\n".join(sections),
        "usedLLM": False,
        "model": "fallback-deterministic",
        "privacyAudit": audit_prompt_info,
        "extractedStudyElements": extracted,
    }


def try_openai_response(request: AssistantRequest) -> dict[str, Any] | None:
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    enable_mock = (
        os.getenv("ENABLE_MOCK_LLM", "").strip().lower() in {"true", "1", "yes"}
        or api_key == "test-mock-key"
    )

    if enable_mock:
        resolved_study_type = request.study_type
        if not resolved_study_type and request.study_context:
            study_meta = request.study_context.get("study_metadata") or {}
            if isinstance(study_meta, dict):
                resolved_study_type = study_meta.get("studyType")

        knowledge_context = get_knowledge_context(request)
        if not knowledge_context and request.prompt:
            knowledge_context = rag_engine.query(
                question=request.prompt,
                study_type=resolved_study_type,
            )

        citations_str = ""
        if isinstance(knowledge_context, dict) and knowledge_context.get("citations"):
            citations_list = [
                f"- 📄 `{c.get('source_file')}` ({c.get('section', 'General')}) — صفحة {c.get('page', 1)}"
                for c in knowledge_context["citations"][:3]
            ]
            citations_str = "\n\n📚 **المراجع العلمية المستخرجة محلياً (RAG Knowledge Engine):**\n" + "\n".join(citations_list)

        prompt_txt = request.prompt or "استفسار سريري"
        mock_answer = (
            f"### 🤖 مساعد البحث السريري والمنهجي\n\n"
            f"بناءً على تحليل الاستفسار: **\"{prompt_txt}\"** ضمن تصميم الدراسة (**{resolved_study_type or 'General Clinical Study'}**):\n\n"
            f"1. **التصميم المنهجي**: تم التأكد من مطابقة المعطيات مع المبادئ المعرفية والإحصائية المعتمدة.\n"
            f"2. **حجم العينة والقوة الإحصائية**: يُنصح بتطبيق اختبارات القوة الإحصائية لحساب العينة بحيث تكون القوة الإحصائية (Power $\\ge 80\\%$) عند مستوى معنوية ($\\alpha = 0.05$).\n"
            f"3. **التوصية التنفيذية**: يمكنك استخدام أدوات الحساب المباشرة والتحقق السريري (Clinical Validation) المتاحة بالمنصة لاستخراج التقرير كاملاً."
            f"{citations_str}"
        )

        audit_prompt_info = redact_phi_with_audit(request.prompt)
        return {
            "answer": mock_answer,
            "usedLLM": True,
            "model": "mock-ai-test-engine",
            "studyType": resolved_study_type,
            "privacyAudit": audit_prompt_info,
            "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt)
            if request.mode in {"protocol_understanding", "study_elements"}
            else None,
        }

    if not api_key and not base_url:
        return None

    try:
        from openai import OpenAI

        client_kwargs: dict[str, Any] = {}
        if api_key:
            client_kwargs["api_key"] = api_key
        else:
            client_kwargs["api_key"] = "dummy-key-for-local-llm"

        if base_url:
            client_kwargs["base_url"] = base_url

        client = OpenAI(**client_kwargs)
        model = os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o")

        resolved_study_type = request.study_type
        if not resolved_study_type and request.study_context:
            study_meta = request.study_context.get("study_metadata") or {}
            if isinstance(study_meta, dict):
                resolved_study_type = study_meta.get("studyType")

        knowledge_context = get_knowledge_context(request)
        if not knowledge_context and request.prompt:
            knowledge_context = rag_engine.query(
                question=request.prompt,
                study_type=resolved_study_type,
            )

        audit_prompt_info = redact_phi_with_audit(request.prompt)
        audit_protocol_info = redact_phi_with_audit(request.protocol_text or "") if request.protocol_text else None

        sanitized_prompt = audit_prompt_info["sanitized_text"]
        sanitized_protocol = audit_protocol_info["sanitized_text"] if audit_protocol_info else None

        system_prompt = build_system_prompt(
            study_type=resolved_study_type,
            mode=request.mode,
            knowledge_context=knowledge_context,
        )
        user_payload = {
            "mode": request.mode,
            "prompt": sanitized_prompt,
            "study_type": resolved_study_type,
            "protocol_text": sanitized_protocol,
            "dataset_profile": request.dataset_profile,
            "statistical_result": request.statistical_result,
            "study_context": request.study_context,
        }
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
        answer_text = response.choices[0].message.content or ""
        return {
            "answer": answer_text,
            "usedLLM": True,
            "model": model,
            "studyType": resolved_study_type,
            "privacyAudit": audit_prompt_info,
            "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt)
            if request.mode in {"protocol_understanding", "study_elements"}
            else None,
        }
    except Exception as e:
        err_str = str(e)
        print(f"LLM API Error: {err_str}")
        if "402" in err_str or "Insufficient Balance" in err_str:
            fallback = build_fallback_assistant_response(request)
            fallback["answer"] = (
                f"⚠️ تنبيه من مزود AI ({model}): تم الاتصال بـ API بنجاح ولكن الحساب بحاجة لشحن رصيد (Error 402: Insufficient Balance).\n\n"
                + fallback["answer"]
            )
            fallback["error"] = "Insufficient Balance (402)"
            return fallback
        elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str:
            fallback = build_fallback_assistant_response(request)
            fallback["answer"] = (
                f"⚠️ تنبيه من مزود AI ({model}): تم الاتصال بمفتاح Gemini API بنجاح ولكن حصة الحساب (Quota) محددة بـ 0 طلبات (Error 429: Quota Exceeded).\n\n"
                + fallback["answer"]
            )
            fallback["error"] = "Quota Exceeded (429)"
            return fallback
        return None


def preprocess_image_for_ocr(file_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode the supplied image.")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.GaussianBlur(gray, (3, 3), 0)
    thresholded = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return thresholded


@app.get("/health")
def health() -> dict[str, Any]:
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    enable_mock = (
        os.getenv("ENABLE_MOCK_LLM", "").strip().lower() in {"true", "1", "yes"}
        or api_key == "test-mock-key"
    )

    return {
        "status": "ok",
        "service": "clinresearch-python-analytics",
        "libraries": {
            "pandas": pd.__version__,
            "scipy": scipy.__version__,
            "statsmodels": sm.__version__,
            "plotly": plotly.__version__,
            "pyreadstat": pyreadstat.__version__,
            "opencv": cv2.__version__,
        },
        "openaiConfigured": bool(api_key or base_url or enable_mock),
        "openaiModel": os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o"),
        "llmBaseUrl": base_url or "https://api.openai.com/v1",
        "mockLLMEnabled": enable_mock,
        "tesseractConfigured": bool(configured_tesseract_cmd),
        "tesseractCommand": configured_tesseract_cmd,
        "knowledgeCatalog": get_catalog_summary(),
    }


@app.get("/knowledge/study-types")
def list_study_types() -> dict[str, Any]:
    return {
        "validStudyTypes": VALID_STUDY_TYPES,
        "studyTypeLabels": STUDY_TYPE_LABELS,
        "summary": get_catalog_summary(),
    }


@app.get("/knowledge/references")
def list_knowledge_references(study_type: str = Query(default="rct")) -> dict[str, Any]:
    if not is_valid_study_type(study_type):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid study_type '{study_type}'. Must be one of: {', '.join(VALID_STUDY_TYPES)}",
        )
    refs = get_references_for_study_type(study_type)
    return {
        "studyType": study_type.lower(),
        "referenceCount": len(refs),
        "references": refs,
    }


@app.post("/dataset/profile")
async def profile_dataset(
    file: UploadFile = File(...),
    options: str = Form(default="{}"),
) -> dict[str, Any]:
    file_bytes = await file.read()
    dataframe = load_dataframe(file.filename, file_bytes)
    cleaned = clean_dataframe(dataframe, json.loads(options or "{}"))
    return {
        "profile": dataframe_profile(cleaned),
        "cleaningApplied": json.loads(options or "{}"),
    }


@app.post("/analysis/recommend")
async def recommend_analysis(config: str = Form(default="{}")) -> dict[str, Any]:
    parsed = json.loads(config or "{}")
    return choose_statistical_test(parsed)


@app.post("/analysis/run")
async def run_analysis(
    file: UploadFile = File(...),
    config: str = Form(default="{}"),
) -> dict[str, Any]:
    parsed_config = json.loads(config or "{}")
    file_bytes = await file.read()
    dataframe = load_dataframe(file.filename, file_bytes)
    cleaned = clean_dataframe(dataframe, parsed_config.get("cleaning", {}))
    result = run_analysis_dispatch(cleaned, parsed_config)
    result["profile"] = dataframe_profile(cleaned)
    return to_jsonable(result)


@app.post("/ocr/extract")
async def extract_ocr(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    thresholded = preprocess_image_for_ocr(file_bytes)
    try:
        text = pytesseract.image_to_string(thresholded)
        ocr_ready = True
        message = "OCR extraction completed."
    except pytesseract.TesseractNotFoundError:
        text = ""
        ocr_ready = False
        message = "Tesseract OCR binary is not installed on the host. OpenCV preprocessing succeeded, but text extraction requires Tesseract."

    return {
        "ocrReady": ocr_ready,
        "message": message,
        "text": text.strip(),
        "preprocessing": {
            "shape": list(thresholded.shape),
            "mode": "grayscale-thresholded",
        },
    }


@app.post("/assistant/chat")
async def assistant_chat(request: AssistantRequest) -> dict[str, Any]:
    llm_response = try_openai_response(request)
    if llm_response:
        return llm_response
    return build_fallback_assistant_response(request)


class KnowledgeQueryBody(BaseModel):
    question: str = Field(default="")
    prompt: str | None = None
    study_type: str | None = None
    filter_source: str | None = None
    limit: int = Field(default=5)


@app.post("/api/v1/query")
async def query_knowledge_base(body: KnowledgeQueryBody) -> dict[str, Any]:
    q = body.question or body.prompt or ""
    return rag_engine.query(
        question=q,
        study_type=body.study_type,
        filter_source=body.filter_source,
        limit=body.limit,
    )


@app.post("/api/v1/ingest")
async def ingest_knowledge_document(
    file: UploadFile = File(...),
    document_type: str = Form(default="reference"),
    study_type: str | None = Form(default=None),
) -> dict[str, Any]:
    file_bytes = await file.read()
    text_content = file_bytes.decode("utf-8", errors="ignore")
    return rag_engine.ingest_text(
        filename=file.filename or "uploaded_doc.txt",
        text=text_content,
        document_type=document_type,
        study_type=study_type,
    )


@app.post("/api/v1/calculate")
async def calculate_sample_size_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    return calculate_sample_size(body)


@app.post("/api/v1/validate")
async def validate_clinical_parameters_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    return validate_clinical_parameters(body)

