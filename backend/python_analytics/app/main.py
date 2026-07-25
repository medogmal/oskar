import io
import json
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
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from statsmodels.duration.survfunc import SurvfuncRight


app = FastAPI(title="ClinResearch Analytics Service", version="1.0.0")


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

    groups = [group.dropna().astype(float) for _name, group in dataframe.groupby(group_column)[value_column]]
    labels = dataframe[group_column].dropna().unique().tolist()
    if len(groups) != 2:
        raise HTTPException(status_code=400, detail="Independent t-test requires exactly two groups.")

    statistic, p_value = stats.ttest_ind(groups[0], groups[1], equal_var=config.get("equal_var", False), nan_policy="omit")
    figure = go.Figure()
    for label, values in zip(labels, groups):
        figure.add_trace(go.Box(y=values, name=str(label)))

    return {
        "analysis": "independent_t_test",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
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
    statistic, p_value = stats.ttest_rel(subset[x_column], subset[y_column], nan_policy="omit")
    figure = go.Figure()
    figure.add_trace(go.Box(y=subset[x_column], name=x_column))
    figure.add_trace(go.Box(y=subset[y_column], name=y_column))
    return {
        "analysis": "paired_t_test",
        "statistic": to_jsonable(statistic),
        "pValue": to_jsonable(p_value),
        "sampleSize": int(len(subset)),
        "means": to_jsonable({x_column: subset[x_column].mean(), y_column: subset[y_column].mean()}),
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

    return {
        "answer": "\n".join(sections),
        "usedLLM": False,
        "model": "fallback-deterministic",
        "extractedStudyElements": extracted,
    }


def try_openai_response(request: AssistantRequest) -> dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        model = os.getenv("OPENAI_MODEL", "gpt-5.5")
        system_prompt = (
            "You are a clinical research AI copilot. Use the provided statistical outputs as the source of truth. "
            "Use study_context.knowledge_context as the authoritative evidence layer when it is present. "
            "If citations are available, ground the answer in them and mention the source file or page inline. "
            "Do not invent p-values, references, citations, or numeric inference. Explain, structure, and draft research content safely."
        )
        user_payload = {
            "mode": request.mode,
            "prompt": request.prompt,
            "protocol_text": request.protocol_text,
            "dataset_profile": request.dataset_profile,
            "statistical_result": request.statistical_result,
            "study_context": request.study_context,
        }
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
        )
        return {
            "answer": response.output_text,
            "usedLLM": True,
            "model": model,
            "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt)
            if request.mode in {"protocol_understanding", "study_elements"}
            else None,
        }
    except Exception:
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
        "openaiConfigured": bool(os.getenv("OPENAI_API_KEY")),
        "openaiModel": os.getenv("OPENAI_MODEL", "gpt-5.5"),
        "tesseractConfigured": bool(configured_tesseract_cmd),
        "tesseractCommand": configured_tesseract_cmd,
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
