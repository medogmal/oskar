import asyncio
import io
import json
import math
import os
import re
import tempfile
import zipfile
import xml.etree.ElementTree as ET

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

from .clinical_validation import validate_clinical_parameters, validate_crf_template
from .knowledge_catalog import (
    STUDY_TYPE_LABELS,
    VALID_STUDY_TYPES,
    get_catalog_summary,
    get_references_for_study_type,
    is_valid_study_type,
)
from .missing_data_engine import analyze_missing_data
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


def looks_like_placeholder_secret(value: str | None) -> bool:
    """Return true for documented placeholder values, without logging the secret."""
    if not value:
        return False

    normalized = re.sub(r"[\s'\"`]+", "", value).lower()
    placeholder_markers = (
        "your_",
        "your-",
        "yourapi",
        "yourrotated",
        "rotated_api_key",
        "api_key_here",
        "placeholder",
        "changeme",
        "change_this",
        "example_key",
    )
    return any(marker in normalized for marker in placeholder_markers)


def is_local_llm_base_url(base_url: str | None) -> bool:
    if not base_url:
        return False
    normalized = base_url.strip().lower()
    return normalized.startswith(("http://127.0.0.1", "http://localhost", "http://0.0.0.0"))


def get_llm_settings() -> dict[str, Any]:
    mistral_key = os.getenv("MISTRAL_API_KEY")
    llm_key = os.getenv("LLM_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")

    api_key = mistral_key or llm_key or openai_key or gemini_key
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    base_url_looks_mistral = bool(base_url and "mistral.ai" in base_url.lower())

    provider = "custom"
    if mistral_key or base_url_looks_mistral:
        provider = "mistral"
        if not base_url:
            base_url = "https://api.mistral.ai/v1"
    elif openai_key:
        provider = "openai"
    elif gemini_key:
        provider = "gemini"

    enable_mock = (
        os.getenv("ENABLE_MOCK_LLM", "").strip().lower() in {"true", "1", "yes"}
        or api_key == "test-mock-key"
    )
    api_key_is_placeholder = looks_like_placeholder_secret(api_key)
    valid_api_key = bool(api_key) and not api_key_is_placeholder
    local_base_url = is_local_llm_base_url(base_url)

    default_model = "mistral-large-latest" if provider == "mistral" else "gpt-4o"
    model = os.getenv("MISTRAL_MODEL") or os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL") or default_model

    return {
        "apiKey": api_key,
        "baseUrl": base_url,
        "provider": provider,
        "mockEnabled": enable_mock,
        "apiKeyPresent": bool(api_key),
        "apiKeyLooksPlaceholder": api_key_is_placeholder,
        "validApiKey": valid_api_key,
        "localBaseUrl": local_base_url,
        "configured": bool(enable_mock or valid_api_key or (base_url and local_base_url)),
        "model": model,
    }



def get_llm_request_timeout_seconds() -> float:
    raw_value = os.getenv("LLM_REQUEST_TIMEOUT_SECONDS") or os.getenv("LLM_TIMEOUT_SECONDS") or "30"
    try:
        timeout_seconds = float(raw_value)
    except ValueError:
        return 30.0
    return max(5.0, min(timeout_seconds, 120.0))


def detect_response_language(*texts: str | None) -> str:
    combined = "\n".join(text.strip() for text in texts if isinstance(text, str) and text.strip())
    if not combined:
        return "english"

    candidates = [combined]
    try:
        repaired = combined.encode("latin1").decode("utf-8")
        if repaired != combined:
            candidates.append(repaired)
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass

    arabic_chars = sum(len(re.findall(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]", item)) for item in candidates)
    mojibake_arabic_markers = len(re.findall(r"[ØÙ][\x80-\xBF]?", combined))
    latin_chars = len(re.findall(r"[A-Za-z]", combined))
    if arabic_chars and arabic_chars >= max(3, latin_chars * 0.25):
        return "arabic"
    if mojibake_arabic_markers >= 3:
        return "arabic"
    return "english"


class AssistantRequest(BaseModel):
    mode: str = Field(default="researcher_response")
    prompt: str = Field(default="")
    protocol_text: str | None = None
    study_type: str | None = None
    response_language: str | None = None
    dataset_profile: dict[str, Any] | None = None
    statistical_result: dict[str, Any] | None = None
    study_context: dict[str, Any] | None = None


def get_request_response_language(request: AssistantRequest) -> str:
    requested = (request.response_language or "").strip().lower()
    if requested in {"arabic", "ar", "rtl"}:
        return "arabic"
    if requested in {"english", "en", "ltr"}:
        return "english"
    return detect_response_language(request.prompt, request.protocol_text)


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


PROPOSAL_ELEMENTS: list[dict[str, Any]] = [
    {
        "key": "general_information",
        "title": "1. General Information",
        "items": [
            "Study title",
            "Short title",
            "Research field",
            "Specialty",
            "Institution",
            "Department",
            "Country",
            "Principal investigator",
            "Supervisors",
            "Study period",
        ],
    },
    {
        "key": "research_design",
        "title": "2. Research Design",
        "items": [
            "Study type",
            "Study setting",
            "Single-center / Multi-center",
            "Prospective / Retrospective",
            "Experimental / Observational",
        ],
    },
    {
        "key": "research_question",
        "title": "3. Research Question",
        "items": [
            "Main research question",
            "PICO / PICOS / PECO",
            "Population",
            "Intervention / Exposure",
            "Comparator",
            "Outcome",
            "Study hypothesis",
            "Null hypothesis",
            "Alternative hypothesis",
        ],
    },
    {
        "key": "objectives",
        "title": "4. Objectives",
        "items": ["Primary aim", "Primary objective", "Secondary objectives"],
    },
    {
        "key": "study_population",
        "title": "5. Study Population",
        "items": [
            "Target population",
            "Source population",
            "Sample population",
            "Age range",
            "Sex",
            "Diagnosis",
            "Disease condition",
            "Clinical characteristics",
        ],
    },
    {
        "key": "eligibility",
        "title": "6. Eligibility",
        "items": ["Inclusion criteria", "Exclusion criteria", "Withdrawal criteria"],
    },
    {
        "key": "sample_size",
        "title": "7. Sample Size",
        "items": [
            "Sample size",
            "Number per group",
            "Total sample",
            "Formula",
            "Statistical test used for calculation",
            "Alpha",
            "Power",
            "Effect size",
            "Expected difference",
            "Standard deviation",
            "Allocation ratio",
            "Expected dropout",
            "Final adjusted sample size",
            "Source/reference for parameters",
        ],
    },
    {
        "key": "sampling",
        "title": "8. Sampling",
        "items": [
            "Sampling method",
            "Recruitment method",
            "Recruitment location",
            "Randomization method",
            "Allocation concealment",
            "Stratification",
            "Block size",
        ],
    },
    {
        "key": "variables",
        "title": "9. Variables",
        "items": [
            "Independent variables",
            "Dependent variables",
            "Primary outcome",
            "Secondary outcomes",
            "Confounders",
            "Covariates",
            "Effect modifiers",
        ],
    },
    {
        "key": "outcome_measures",
        "title": "10. Outcome Measures",
        "items": [
            "Outcome name",
            "Primary/secondary",
            "Definition",
            "Measurement method",
            "Measurement instrument",
            "Unit",
            "Time point",
            "Baseline measurement",
            "Follow-up measurement",
            "Clinically meaningful difference",
        ],
    },
    {
        "key": "intervention",
        "title": "11. Intervention",
        "items": [
            "Intervention name",
            "Protocol",
            "Dose/intensity if applicable",
            "Duration",
            "Frequency",
            "Operator",
            "Standardization",
            "Intervention group",
        ],
    },
    {
        "key": "control_comparator",
        "title": "12. Control / Comparator",
        "items": [
            "Control type",
            "Comparator intervention",
            "Placebo/sham if applicable",
            "Standard care",
        ],
    },
    {
        "key": "follow_up",
        "title": "13. Follow-up",
        "items": [
            "Follow-up duration",
            "Number of visits",
            "Assessment time points",
            "Lost-to-follow-up definition",
            "Dropout management",
        ],
    },
    {
        "key": "data_collection",
        "title": "14. Data Collection",
        "items": [
            "Clinical examination",
            "Radiographs",
            "CBCT",
            "Intraoral scans",
            "Digital models",
            "Photographs",
            "Questionnaires",
            "Medical/dental records",
            "Laboratory measurements",
        ],
    },
    {
        "key": "measurement_reliability",
        "title": "15. Measurement Reliability",
        "items": [
            "Examiner(s)",
            "Calibration",
            "Intra-examiner reliability",
            "Inter-examiner reliability",
            "ICC",
            "Kappa",
            "Measurement error",
            "Dahlberg error",
        ],
    },
    {
        "key": "blinding",
        "title": "16. Blinding",
        "items": [
            "Participant blinded?",
            "Operator blinded?",
            "Outcome assessor blinded?",
            "Statistician blinded?",
            "Blinding method",
        ],
    },
    {
        "key": "statistical_analysis",
        "title": "17. Statistical Analysis",
        "items": [
            "Statistical software",
            "Descriptive statistics",
            "Normality test",
            "Statistical tests",
            "Primary analysis",
            "Secondary analysis",
            "Subgroup analysis",
            "Regression analysis",
            "Missing-data method",
            "Significance level",
            "Confidence interval",
            "Effect estimate",
        ],
    },
    {
        "key": "ethics",
        "title": "18. Ethics",
        "items": [
            "Ethical approval",
            "IRB",
            "Informed consent",
            "Patient confidentiality",
            "Data protection",
            "Risks",
            "Benefits",
            "Adverse events",
            "Trial registration",
        ],
    },
    {
        "key": "bias_quality_control",
        "title": "19. Bias / Quality Control",
        "items": [
            "Selection bias",
            "Performance bias",
            "Detection bias",
            "Attrition bias",
            "Reporting bias",
            "Confounding",
            "Quality control procedures",
        ],
    },
    {
        "key": "expected_results",
        "title": "20. Expected Results",
        "items": [
            "Expected primary outcome",
            "Expected secondary outcomes",
            "Expected clinical significance",
        ],
    },
    {
        "key": "limitations",
        "title": "21. Limitations",
        "items": ["Reported limitations", "Potential limitations detected by AI"],
    },
    {
        "key": "timeline",
        "title": "22. Timeline",
        "items": ["Recruitment", "Intervention", "Follow-up", "Data analysis", "Completion"],
    },
    {
        "key": "references",
        "title": "23. References",
        "items": [
            "Number of references",
            "Key references",
            "References supporting sample size",
            "References supporting methodology",
            "References supporting outcomes",
        ],
    },
]


def normalize_study_type_value(raw_value: Any) -> str | None:
    value = str(raw_value or "").strip().lower()
    if not value:
        return None
    value = value.replace("-", "_").replace(" ", "_")
    if "random" in value or "rct" in value:
        return "rct"
    if "prospective" in value or "cohort" in value:
        return "prospective"
    if "retrospective" in value or "record" in value or "ehr" in value:
        return "retrospective"
    if "cross" in value or "sectional" in value or "survey" in value:
        return "cross_sectional"
    if "vitro" in value or "laboratory" in value or "lab" in value:
        return "in_vitro"
    return value if value in VALID_STUDY_TYPES else None


def get_resolved_study_type(request: AssistantRequest) -> str | None:
    direct = normalize_study_type_value(request.study_type)
    if direct:
        return direct
    study_context = request.study_context or {}
    study_meta = study_context.get("study_metadata") if isinstance(study_context, dict) else None
    if isinstance(study_meta, dict):
        return normalize_study_type_value(study_meta.get("studyType") or study_meta.get("study_type"))
    return None


def get_study_metadata(request: AssistantRequest) -> dict[str, Any]:
    study_context = request.study_context or {}
    if not isinstance(study_context, dict):
        return {}
    study_meta = study_context.get("study_metadata")
    return study_meta if isinstance(study_meta, dict) else {}


def build_protocol_text_for_crf(request: AssistantRequest) -> str:
    study_meta = get_study_metadata(request)
    parts: list[str] = []
    for label, key in [
        ("Study title", "title"),
        ("Description", "description"),
        ("Study type", "studyType"),
        ("Target sample size", "targetSampleSize"),
        ("Randomization", "hasRandomization"),
        ("Randomization method", "randomizationMethod"),
        ("Blinding", "hasBlinding"),
        ("Ethics approval", "ethicsApprovalNumber"),
        ("Trial registration", "clinicalRegistrationNumber"),
    ]:
        value = study_meta.get(key)
        if value not in (None, "", []):
            parts.append(f"{label}: {value}")

    groups = study_meta.get("groups")
    if isinstance(groups, list) and groups:
        parts.append(f"Study groups: {', '.join(str(item) for item in groups)}")

    blinding = study_meta.get("blindingSettings")
    if isinstance(blinding, dict) and blinding:
        parts.append(f"Blinding settings: {json.dumps(blinding, ensure_ascii=False)}")

    if request.protocol_text:
        parts.append(request.protocol_text)
    elif request.prompt:
        parts.append(request.prompt)

    return "\n".join(str(part) for part in parts if str(part).strip()).strip()


def text_has_any(text: str, keywords: list[str]) -> bool:
    normalized = text.lower()
    return any(keyword.lower() in normalized for keyword in keywords)


def extract_value_after_label(text: str, labels: list[str], max_chars: int = 180) -> str | None:
    for label in labels:
        patterns = [
            re.compile(rf"(?:^|[\n\r])\s*(?:#+\s*)?{re.escape(label)}\s*[:=\-]\s*([^\n\r]{{1,{max_chars}}})", re.IGNORECASE),
            re.compile(rf"(?:^|[\n\r])\s*(?:#+\s*)?{re.escape(label)}\s*[\n\r]+\s*([^\n\r]{{1,{max_chars}}})", re.IGNORECASE),
        ]
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).strip(" .;:-")
    return None


def get_context_value_for_item(label: str, study_meta: dict[str, Any]) -> Any:
    normalized = label.lower()
    if "study title" in normalized:
        return study_meta.get("title")
    if "study type" in normalized:
        return study_meta.get("studyType")
    if "sample size" in normalized or "total sample" in normalized:
        return study_meta.get("targetSampleSize")
    if "randomization method" in normalized:
        return study_meta.get("randomizationMethod")
    if "randomization" in normalized:
        return study_meta.get("hasRandomization")
    if "blinding" in normalized:
        return study_meta.get("hasBlinding")
    if "ethical approval" in normalized or "irb" in normalized:
        return study_meta.get("ethicsApprovalNumber")
    if "trial registration" in normalized:
        return study_meta.get("clinicalRegistrationNumber")
    if "intervention group" in normalized or "number per group" in normalized or "allocation ratio" in normalized:
        groups = study_meta.get("groups")
        if isinstance(groups, list) and groups:
            return ", ".join(str(item) for item in groups)
    return None


def keywords_for_label(label: str) -> list[str]:
    base = label.lower().replace("/", " ").replace("?", "").replace("-", " ")
    words = [word for word in re.split(r"[^a-z0-9]+", base) if len(word) >= 4]
    aliases: dict[str, list[str]] = {
        "primary outcome": ["primary outcome", "primary endpoint", "main outcome"],
        "secondary outcomes": ["secondary outcome", "secondary endpoint"],
        "inclusion criteria": ["inclusion criteria", "eligible", "eligibility"],
        "exclusion criteria": ["exclusion criteria", "excluded"],
        "sample size": ["sample size", "power calculation", "power analysis"],
        "alpha": ["alpha", "significance level", "type i error"],
        "power": ["power", "1-beta", "beta"],
        "effect size": ["effect size", "cohen", "odds ratio", "hazard ratio"],
        "allocation concealment": ["allocation concealment", "sealed envelope", "central randomization"],
        "blinding method": ["blinding method", "masked", "double blind", "single blind"],
        "dropout management": ["dropout", "attrition", "loss to follow-up", "lost to follow-up"],
        "statistical tests": ["t-test", "anova", "chi-square", "mann-whitney", "wilcoxon", "regression"],
        "clinical examination": ["clinical examination", "clinical exam"],
        "radiographs": ["radiograph", "x-ray", "xray"],
        "cbct": ["cbct", "cone beam"],
        "photographs": ["photograph", "photo"],
        "medical/dental records": ["record", "ehr", "chart review"],
        "informed consent": ["informed consent", "consent"],
    }
    keywords = aliases.get(base, [])
    keywords.extend(words[:4])
    keywords.append(label.lower())
    return list(dict.fromkeys(keywords))


def infer_dental_specialty(text: str, study_meta: dict[str, Any]) -> str:
    joined = f"{study_meta.get('title', '')} {study_meta.get('description', '')} {text}".lower()
    specialty_keywords = [
        ("orthodontics", ["orthodont", "malocclusion", "overjet", "overbite", "cephalometric", "aligner", "bracket"]),
        ("periodontology", ["periodontal", "periodontitis", "pocket depth", "bleeding on probing", "cal", "plaque index"]),
        ("implantology", ["implant", "osseointegration", "peri-implant", "bone loss"]),
        ("endodontics", ["endodont", "root canal", "periapical", "pulp", "obturation"]),
        ("restorative dentistry", ["restorative", "composite", "bond strength", "adhesive", "restoration"]),
        ("oral surgery", ["extraction", "surgery", "third molar", "maxillofacial", "postoperative"]),
        ("pediatric dentistry", ["pediatric", "children", "dmft", "fluorosis", "sealant"]),
        ("oral radiology", ["cbct", "panoramic", "cephalometric", "radiograph"]),
    ]
    for specialty, keywords in specialty_keywords:
        if any(keyword in joined for keyword in keywords):
            return specialty
    return "general dentistry"


def extract_outcome_names(text: str) -> list[str]:
    candidates: list[str] = []
    for label in ["Primary outcome", "Primary endpoint", "Main outcome", "Secondary outcome", "Outcome measure"]:
        value = extract_value_after_label(text, [label], max_chars=120)
        if value:
            candidates.append(value)
    for line in text.splitlines():
        clean = line.strip(" -\t")
        if len(clean) > 15 and re.search(r"\b(outcome|endpoint|measure)\b", clean, flags=re.IGNORECASE):
            candidates.append(clean[:120])
    unique: list[str] = []
    for item in candidates:
        compact = re.sub(r"\s+", " ", item).strip(" .;:-")
        if compact and compact.lower() not in {seen.lower() for seen in unique}:
            unique.append(compact)
    return unique[:4]


def extract_numeric_sample_size(text: str, study_meta: dict[str, Any]) -> int | None:
    value = study_meta.get("targetSampleSize")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    match = re.search(r"(?:sample size|total sample|n\s*=)\D{0,20}(\d{1,5})", text, flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def build_proposal_extraction_layer(text: str, study_meta: dict[str, Any]) -> list[dict[str, Any]]:
    extraction: list[dict[str, Any]] = []
    for element in PROPOSAL_ELEMENTS:
        items = []
        present_count = 0
        for label in element["items"]:
            context_value = get_context_value_for_item(label, study_meta)
            value = None
            if context_value not in (None, "", [], {}):
                value = str(context_value)
            else:
                value = extract_value_after_label(text, [label])

            present = bool(value) or text_has_any(text, keywords_for_label(label))
            if present:
                present_count += 1
            items.append({
                "label": label,
                "present": present,
                "value": value if value else ("Detected in proposal text" if present else None),
            })

        item_count = max(1, len(element["items"]))
        if present_count == 0:
            status = "missing"
        elif present_count / item_count < 0.5:
            status = "partial"
        else:
            status = "complete"

        extraction.append({
            "key": element["key"],
            "title": element["title"],
            "status": status,
            "presentCount": present_count,
            "totalCount": item_count,
            "items": items,
        })
    return extraction


def build_validation_layer(text: str, study_type: str | None, study_meta: dict[str, Any]) -> list[dict[str, str]]:
    has_primary_outcome = text_has_any(text, ["primary outcome", "primary endpoint", "main outcome"])
    has_sample_size = extract_numeric_sample_size(text, study_meta) is not None or text_has_any(text, ["sample size", "power calculation", "power analysis"])
    has_alpha = text_has_any(text, ["alpha", "significance level", "0.05", "type i error"])
    has_power = text_has_any(text, ["power", "80%", "90%", "1-beta"])
    has_effect_size = text_has_any(text, ["effect size", "cohen", "odds ratio", "hazard ratio", "expected difference"])
    has_stat_test = text_has_any(text, ["t-test", "anova", "chi-square", "mann-whitney", "wilcoxon", "regression", "kaplan", "cox"])
    has_dropout = text_has_any(text, ["dropout", "attrition", "lost to follow-up", "loss to follow-up"])
    explicit_blinding = study_meta.get("hasBlinding")
    explicit_randomization = study_meta.get("hasRandomization")
    has_blinding = (
        explicit_blinding is True
        or (explicit_blinding is None and text_has_any(text, ["blind", "masked", "masking"]))
    )
    has_randomization = (
        explicit_randomization is True
        or (explicit_randomization is None and text_has_any(text, ["randomization", "randomisation", "randomized", "randomised"]))
    )
    has_allocation = text_has_any(text, ["allocation concealment", "sealed envelope", "central randomization", "opaque envelope"])
    has_sampling = text_has_any(text, ["sampling", "recruitment", "consecutive", "random sample", "convenience sample"])
    has_confounders = text_has_any(text, ["confounder", "covariate", "adjusted", "propensity"])
    has_missing_data = text_has_any(text, ["missing data", "imputation", "complete-case", "multiple imputation"])

    validations = [
        {
            "id": "primary_outcome",
            "status": "pass" if has_primary_outcome else "missing",
            "severity": "critical",
            "message": "Primary outcome is clearly defined." if has_primary_outcome else "Primary outcome not clearly defined.",
        },
        {
            "id": "sample_size_parameters",
            "status": "pass" if has_sample_size and has_alpha and has_power and has_effect_size else "missing",
            "severity": "critical",
            "message": "Sample size parameters include sample size, alpha, power, and effect size." if has_sample_size and has_alpha and has_power and has_effect_size else "Sample size calculation parameters incomplete.",
        },
        {
            "id": "primary_statistical_test",
            "status": "pass" if has_stat_test else "missing",
            "severity": "critical",
            "message": "Statistical test for the primary outcome is specified." if has_stat_test else "Statistical test for primary outcome not specified.",
        },
        {
            "id": "dropout_adjustment",
            "status": "pass" if has_dropout else "missing",
            "severity": "warning",
            "message": "Dropout/lost-to-follow-up adjustment is reported." if has_dropout else "Dropout adjustment not reported.",
        },
    ]

    if study_type == "rct":
        validations.extend([
            {
                "id": "randomization_method",
                "status": "pass" if has_randomization else "missing",
                "severity": "critical",
                "message": "Randomization method is specified." if has_randomization else "Randomization method not specified.",
            },
            {
                "id": "allocation_concealment",
                "status": "pass" if has_allocation else "missing",
                "severity": "critical",
                "message": "Allocation concealment is reported." if has_allocation else "Allocation concealment not reported.",
            },
            {
                "id": "blinding",
                "status": "pass" if has_blinding else "missing",
                "severity": "critical",
                "message": "Blinding is described." if has_blinding else "Blinding not described.",
            },
        ])
    elif study_type in {"prospective", "retrospective", "cross_sectional"}:
        validations.extend([
            {
                "id": "sampling_recruitment",
                "status": "pass" if has_sampling else "missing",
                "severity": "critical",
                "message": "Sampling/recruitment method is specified." if has_sampling else "Sampling or recruitment method not specified.",
            },
            {
                "id": "confounding_plan",
                "status": "pass" if has_confounders else "warning",
                "severity": "warning",
                "message": "Confounders/covariates are addressed." if has_confounders else "Potential confounders or covariates need clarification.",
            },
            {
                "id": "missing_data_plan",
                "status": "pass" if has_missing_data else "warning",
                "severity": "warning",
                "message": "Missing-data method is specified." if has_missing_data else "Missing-data handling is not clearly described.",
            },
        ])

    return validations


def slugify_field_id(label: str, existing: set[str]) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", label.lower()).strip("_")
    if not slug:
        slug = "field"
    base = slug[:48]
    candidate = base
    suffix = 2
    while candidate in existing:
        candidate = f"{base}_{suffix}"
        suffix += 1
    existing.add(candidate)
    return candidate


def build_crf_fields(
    text: str,
    study_type: str | None,
    specialty: str,
    study_meta: dict[str, Any],
) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    existing: set[str] = set()

    def add(label: str, response_type: str = "text", section: str = "General", options: list[str] | None = None, required: bool = False, note: str | None = None):
        field: dict[str, Any] = {
            "id": slugify_field_id(f"{section}_{label}", existing),
            "label": label,
            "responseType": response_type,
            "section": section,
            "required": required,
        }
        if options:
            field["options"] = options
        if note:
            field["note"] = note
        fields.append(field)

    add("Subject ID / screening code", "text", "Patient Details", required=True)
    add("Visit number", "text", "Patient Details", required=True)
    add("Assessment date", "text", "Patient Details", required=True)
    add("Age", "numeric", "Patient Details")
    add("Sex", "choice", "Patient Details", ["Female", "Male", "Prefer not to say"])
    add("Relevant medical history", "text", "History")
    add("Dental history and previous treatment", "text", "History")
    add("Main complaint / reason for visit", "text", "History")
    add("Meets all inclusion criteria?", "boolean", "Eligibility", required=True)
    add("Any exclusion criterion present?", "boolean", "Eligibility", required=True)
    add("Informed consent obtained?", "boolean", "Eligibility")
    add("Withdrawal or protocol deviation reason", "text", "Eligibility")

    if specialty == "orthodontics":
        add("Anteroposterior skeletal/dental relationship", "choice", "Extra-oral Examination", ["Class I", "Class II", "Class III", "Not assessable"])
        add("Vertical facial proportions", "choice", "Extra-oral Examination", ["Reduced", "Average", "Increased"])
        add("Transverse symmetry", "choice", "Extra-oral Examination", ["Symmetrical", "Asymmetrical"])
        add("Smile aesthetics notes", "text", "Extra-oral Examination")
        add("TMJ signs or symptoms", "text", "Extra-oral Examination")
        add("Teeth present / missing teeth", "text", "Intra-oral Examination")
        add("Oral hygiene", "choice", "Intra-oral Examination", ["Poor", "Fair", "Good", "Excellent"])
        add("Periodontal health", "text", "Intra-oral Examination")
        add("Upper arch crowding/spacing (mm)", "numeric", "Intra-oral Examination")
        add("Lower arch crowding/spacing (mm)", "numeric", "Intra-oral Examination")
        add("Overjet (mm)", "numeric", "Occlusion")
        add("Overbite (%) or mm", "numeric", "Occlusion")
        add("Molar relationship right", "choice", "Occlusion", ["Class I", "Class II", "Class III", "Not assessable"])
        add("Molar relationship left", "choice", "Occlusion", ["Class I", "Class II", "Class III", "Not assessable"])
        add("Canine relationship right", "choice", "Occlusion", ["Class I", "Class II", "Class III", "Not assessable"])
        add("Canine relationship left", "choice", "Occlusion", ["Class I", "Class II", "Class III", "Not assessable"])
        add("Crossbite / displacement notes", "text", "Occlusion")
    elif specialty == "periodontology":
        add("Plaque index", "numeric", "Periodontal Examination")
        add("Bleeding on probing (%)", "numeric", "Periodontal Examination")
        add("Probing pocket depth (mm)", "numeric", "Periodontal Examination")
        add("Clinical attachment level (mm)", "numeric", "Periodontal Examination")
        add("Tooth mobility", "choice", "Periodontal Examination", ["0", "I", "II", "III"])
        add("Furcation involvement", "choice", "Periodontal Examination", ["None", "Class I", "Class II", "Class III"])
        add("Radiographic bone level", "text", "Radiographic Assessment")
    elif specialty == "implantology":
        add("Implant site / tooth region", "text", "Implant Assessment")
        add("Implant stability", "choice", "Implant Assessment", ["Poor", "Fair", "Good", "Excellent"])
        add("Peri-implant probing depth (mm)", "numeric", "Implant Assessment")
        add("Marginal bone loss (mm)", "numeric", "Implant Assessment")
        add("Peri-implant bleeding/suppuration", "boolean", "Implant Assessment")
        add("Osseointegration status", "choice", "Implant Assessment", ["Absent", "Partial", "Complete"])
    elif specialty == "endodontics":
        add("Tooth number", "text", "Endodontic Assessment")
        add("Pain score (VAS 0-10)", "numeric", "Endodontic Assessment")
        add("Percussion tenderness", "choice", "Endodontic Assessment", ["None", "Mild", "Moderate", "Severe"])
        add("Palpation tenderness", "choice", "Endodontic Assessment", ["None", "Mild", "Moderate", "Severe"])
        add("Periapical lesion status", "choice", "Radiographic Assessment", ["Absent", "Present", "Improving", "Resolved"])
        add("Root filling quality", "choice", "Radiographic Assessment", ["Poor", "Adequate", "Excellent"])
    elif specialty == "pediatric dentistry":
        add("DMFT/dmft score", "numeric", "Oral Health Indices")
        add("ICDAS lesion score", "choice", "Oral Health Indices", ["0", "1", "2", "3", "4", "5", "6"])
        add("Dean fluorosis index", "choice", "Oral Health Indices", ["Normal", "Questionable", "Very mild", "Mild", "Moderate", "Severe"])
        add("Behavior rating", "choice", "Clinical Examination", ["Positive", "Negative", "Definitely negative", "Definitely positive"])
    else:
        add("Diagnosis / condition under study", "text", "Clinical Examination", required=True)
        add("Clinical examination findings", "text", "Clinical Examination")
        add("Radiographic findings", "text", "Radiographic Assessment")
        add("Photographs / scans completed?", "boolean", "Data Collection")

    outcomes = extract_outcome_names(text)
    if outcomes:
        for index, outcome in enumerate(outcomes, start=1):
            label = f"{'Primary' if index == 1 else 'Secondary'} outcome value - {outcome[:80]}"
            add(label, "numeric", "Outcome Measures", required=index == 1)
            add(f"{'Primary' if index == 1 else 'Secondary'} outcome measurement notes", "text", "Outcome Measures")
    else:
        add("Primary outcome value", "numeric", "Outcome Measures", required=True)
        add("Primary outcome definition confirmed?", "boolean", "Outcome Measures", required=True)
        add("Secondary outcome notes", "text", "Outcome Measures")

    if study_type == "rct":
        groups = study_meta.get("groups")
        group_options = [str(item) for item in groups] if isinstance(groups, list) and groups else ["Intervention", "Control"]
        add("Randomization code", "text", "Randomization and Blinding", required=True)
        add("Allocated group", "choice", "Randomization and Blinding", group_options)
        add("Blinding maintained at assessment?", "boolean", "Randomization and Blinding")
        add("Intervention adherence", "choice", "Intervention", ["Full", "Partial", "Not received", "Unknown"])
        add("Adverse event occurred?", "boolean", "Safety")
        add("Adverse event details", "text", "Safety")
    elif study_type == "prospective":
        add("Baseline measurement completed?", "boolean", "Follow-up", required=True)
        add("Follow-up time point", "text", "Follow-up", required=True)
        add("Lost to follow-up?", "boolean", "Follow-up")
        add("Event occurred?", "boolean", "Follow-up")
        add("Time to event / outcome", "numeric", "Follow-up")
    elif study_type == "retrospective":
        add("Medical/dental record ID", "text", "Record Abstraction", required=True)
        add("Record source", "choice", "Record Abstraction", ["Paper chart", "Electronic record", "Registry", "Radiology archive", "Other"])
        add("Index date", "text", "Record Abstraction")
        add("Data abstraction complete?", "boolean", "Record Abstraction")
        add("Missing record fields", "text", "Data Quality")
        add("Confounders documented?", "boolean", "Data Quality")
    elif study_type == "cross_sectional":
        add("Sampling cluster / location", "text", "Survey Data", required=True)
        add("Survey weight", "numeric", "Survey Data")
        add("Examiner ID", "text", "Survey Data")
        add("WHO oral health index used", "choice", "Survey Data", ["DMFT/dmft", "CPI/CPITN", "Dean fluorosis index", "Other"])
    elif study_type == "in_vitro":
        add("Specimen ID", "text", "Laboratory Assessment", required=True)
        add("Material group", "choice", "Laboratory Assessment", ["Experimental", "Control", "Comparator"])
        add("Testing machine calibrated?", "boolean", "Laboratory Assessment")
        add("Measured force / value", "numeric", "Laboratory Outcome")
        add("Failure mode", "choice", "Laboratory Outcome", ["Adhesive", "Cohesive", "Mixed", "Not applicable"])

    add("Examiner ID", "text", "Measurement Reliability")
    add("Calibration status", "choice", "Measurement Reliability", ["Calibrated", "Pending", "Not applicable"])
    add("Repeat measurement required?", "boolean", "Measurement Reliability")
    add("Assessor comments", "text", "Final Notes")
    return fields


def build_crf_generation_result(request: AssistantRequest) -> dict[str, Any]:
    text = build_protocol_text_for_crf(request)
    study_meta = get_study_metadata(request)
    study_type = get_resolved_study_type(request)
    specialty = infer_dental_specialty(text, study_meta)
    extraction = build_proposal_extraction_layer(text, study_meta)
    validation = build_validation_layer(text, study_type, study_meta)
    fields = build_crf_fields(text, study_type, specialty, study_meta)
    
    # Run Variable Conflict, Duplicate, and SAP Compatibility validation
    crf_val = validate_crf_template(fields, study_type)
    
    for err in crf_val["errors"]:
        validation.append({
            "id": "crf_validation_error",
            "status": "missing",
            "severity": "critical",
            "message": err
        })
    for warn in crf_val["warnings"]:
        validation.append({
            "id": "crf_validation_warning",
            "status": "warning",
            "severity": "warning",
            "message": warn
        })
        
    missing_information = [item["message"] for item in validation if item["status"] in {"missing", "warning"}]
    knowledge_context = get_knowledge_context(request)
    citations = knowledge_context.get("citations") if isinstance(knowledge_context.get("citations"), list) else []
    sample_size = extract_numeric_sample_size(text, study_meta)
    outcome_names = extract_outcome_names(text)

    if not text or len(text) < 80:
        missing_information.insert(0, "Research proposal text is too limited; upload or paste the full proposal before finalizing the CRF.")

    summary_parts = [
        f"Study type: {study_type or 'general clinical study'}",
        f"Dental specialty: {specialty}",
        f"Sample size: {sample_size if sample_size else 'not clearly extracted'}",
        f"Primary outcome: {outcome_names[0] if outcome_names else 'not clearly extracted'}",
    ]

    return {
        "extracted_summary": "; ".join(summary_parts),
        "study_type": study_type,
        "specialty": specialty,
        "extraction": extraction,
        "validation": validation,
        "missing_information": list(dict.fromkeys(missing_information)),
        "fields": fields,
        "knowledge_citations": citations[:5],
    }


def extract_json_object(text: str) -> dict[str, Any] | None:
    clean_json = text.strip()
    if clean_json.startswith("```json"):
        clean_json = clean_json[7:]
    elif clean_json.startswith("```"):
        clean_json = clean_json[3:]
    if clean_json.endswith("```"):
        clean_json = clean_json[:-3]
    clean_json = clean_json.strip()
    try:
        parsed = json.loads(clean_json)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = clean_json.find("{")
    end = clean_json.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(clean_json[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def normalize_crf_result(raw_result: dict[str, Any] | None, fallback: dict[str, Any]) -> dict[str, Any]:
    if not raw_result:
        return fallback

    normalized = dict(fallback)
    for key in ["extracted_summary", "study_type", "specialty"]:
        value = raw_result.get(key)
        if isinstance(value, str) and value.strip():
            normalized[key] = value.strip()
    if isinstance(raw_result.get("missing_information"), list):
        normalized["missing_information"] = [str(item) for item in raw_result["missing_information"] if str(item).strip()]
    if isinstance(raw_result.get("extraction"), list):
        normalized["extraction"] = raw_result["extraction"]
    if isinstance(raw_result.get("validation"), list):
        normalized["validation"] = raw_result["validation"]

    raw_fields = raw_result.get("fields")
    fields: list[dict[str, Any]] = []
    existing: set[str] = set()
    existing_labels: set[str] = set()

    def normalize_field_id(raw_id: Any, label: str) -> str:
        candidate = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw_id or "").lower()).strip("_")[:48]
        if not candidate:
            return slugify_field_id(label, existing)
        base = candidate
        suffix = 2
        while candidate in existing:
            candidate = f"{base}_{suffix}"
            suffix += 1
        existing.add(candidate)
        return candidate

    def field_label_key(label: str) -> str:
        return re.sub(r"\s+", " ", label.strip().lower())

    def append_field(item: dict[str, Any], default_section: str = "AI Generated") -> None:
        label = str(item.get("label") or "").strip()
        response_type = str(item.get("responseType") or item.get("response_type") or "text").strip()
        if not label or response_type not in {"text", "numeric", "choice", "boolean"}:
            return
        label_key = field_label_key(label)
        if label_key in existing_labels:
            return
        field = {
            "id": normalize_field_id(item.get("id"), label),
            "label": label,
            "responseType": response_type,
            "section": str(item.get("section") or default_section),
            "required": bool(item.get("required", False)),
        }
        if isinstance(item.get("options"), list):
            options = [str(option) for option in item["options"] if str(option).strip()]
            if options:
                field["options"] = options
        if isinstance(item.get("note"), str):
            field["note"] = item["note"]
        existing_labels.add(label_key)
        fields.append(field)

    if isinstance(raw_fields, list):
        for item in raw_fields:
            if isinstance(item, dict):
                append_field(item)

    fallback_fields = fallback.get("fields")
    if isinstance(fallback_fields, list):
        for item in fallback_fields:
            if isinstance(item, dict):
                append_field(item, default_section=str(item.get("section") or "Proposal-Based Core Fields"))

    if fields:
        normalized["fields"] = fields
    return normalized


def extract_study_elements(protocol_text: str) -> dict[str, Any]:
    lines = [line.strip("- ").strip() for line in protocol_text.splitlines() if line.strip()]
    short_text = " ".join(lines)
    title = extract_value_after_label(protocol_text, ["Title", "Study title", "Protocol title"], max_chars=220)
    objective = extract_value_after_label(
        protocol_text,
        ["Objective", "Objectives", "Aim", "Aims", "Purpose", "Primary objective", "Research question"],
        max_chars=260,
    )
    return {
        "title": title or (lines[0] if lines else "Untitled protocol"),
        "objective": objective or (lines[1] if len(lines) > 1 else short_text[:180]),
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
    response_language = get_request_response_language(request)

    sections = build_knowledge_evidence_lines(request)
    if mode == "crf_generation":
        crf_result = build_crf_generation_result(request)
        sections.append("CRF generation completed with three layers: proposal extraction, validation, and missing-information detection.")
        sections.append(crf_result["extracted_summary"])
        if crf_result.get("missing_information"):
            sections.append("Missing information:")
            sections.extend([f"- {item}" for item in crf_result["missing_information"][:8]])

        audit_prompt_info = redact_phi_with_audit(request.prompt)
        return {
            "answer": "\n".join(sections),
            "usedLLM": False,
            "model": "fallback-deterministic-crf-engine",
            "provider": get_llm_settings().get("provider") or "deterministic",
            "responseLanguage": response_language,
            "privacyAudit": audit_prompt_info,
            "crfResult": crf_result,
            "extractedStudyElements": extracted,
        }
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
        "provider": get_llm_settings().get("provider") or "deterministic",
        "responseLanguage": response_language,
        "privacyAudit": audit_prompt_info,
        "extractedStudyElements": extracted,
    }


def try_openai_response(request: AssistantRequest) -> dict[str, Any] | None:
    llm_settings = get_llm_settings()
    api_key = llm_settings["apiKey"] if llm_settings["validApiKey"] else None
    base_url = llm_settings["baseUrl"]
    enable_mock = llm_settings["mockEnabled"]

    if enable_mock:
        resolved_study_type = get_resolved_study_type(request)
        response_language = get_request_response_language(request)

        knowledge_context = get_knowledge_context(request)
        if not knowledge_context and request.prompt:
            knowledge_context = rag_engine.query(
                question=request.prompt,
                study_type=resolved_study_type,
            )

        if request.mode == "crf_generation":
            crf_result = build_crf_generation_result(request)
            audit_prompt_info = redact_phi_with_audit(request.prompt)
            return {
                "answer": json.dumps(crf_result, ensure_ascii=False, indent=2),
                "usedLLM": True,
                "model": "mock-ai-test-engine",
                "provider": llm_settings["provider"],
                "responseLanguage": response_language,
                "studyType": resolved_study_type,
                "privacyAudit": audit_prompt_info,
                "crfResult": crf_result,
                "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt),
            }

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
            "provider": llm_settings["provider"],
            "responseLanguage": response_language,
            "studyType": resolved_study_type,
            "privacyAudit": audit_prompt_info,
            "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt)
            if request.mode in {"protocol_understanding", "study_elements"}
            else None,
        }

    if not llm_settings["configured"]:
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
        client_kwargs["timeout"] = get_llm_request_timeout_seconds()

        client = OpenAI(**client_kwargs)
        model = llm_settings["model"]

        resolved_study_type = get_resolved_study_type(request)
        response_language = get_request_response_language(request)

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
            response_language=response_language,
        )
        user_payload = {
            "mode": request.mode,
            "prompt": sanitized_prompt,
            "response_language": response_language,
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
        
        crf_result = None
        if request.mode == "crf_generation":
            fallback_crf = build_crf_generation_result(request)
            crf_result = normalize_crf_result(extract_json_object(answer_text), fallback_crf)

        return {
            "answer": answer_text,
            "usedLLM": True,
            "model": model,
            "provider": llm_settings["provider"],
            "responseLanguage": response_language,
            "studyType": resolved_study_type,
            "privacyAudit": audit_prompt_info,
            "crfResult": crf_result,
            "extractedStudyElements": extract_study_elements(request.protocol_text or request.prompt)
            if request.mode in {"protocol_understanding", "study_elements"}
            else None,
        }
    except Exception as e:
        err_str = str(e)
        print(f"LLM API Error: {err_str}")
        if "timeout" in err_str.lower() or "timed out" in err_str.lower():
            fallback = build_fallback_assistant_response(request)
            fallback["answer"] = (
                f"⚠️ تنبيه من مزود AI ({model}): استغرقت الاستجابة وقتًا أطول من المسموح، لذلك تم استخدام الرد المحلي الاحتياطي.\n\n"
                + fallback["answer"]
            )
            fallback["error"] = "LLM Request Timeout"
            return fallback
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


def extract_docx_text(file_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            xml_bytes = archive.read("word/document.xml")
    except Exception:
        return ""

    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return ""

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        combined = "".join(texts).strip()
        if combined:
            paragraphs.append(combined)
    return "\n".join(paragraphs)


def extract_pdf_text(file_bytes: bytes) -> tuple[str, dict[str, Any]]:
    try:
        import pypdf
    except Exception:
        return "", {
            "ready": False,
            "message": "PDF text extraction requires the pypdf package. Install backend/python_analytics requirements and retry.",
            "pages": 0,
        }

    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        text = "\n\n".join(page.strip() for page in pages if page.strip())
        return text, {
            "ready": bool(text.strip()),
            "message": "PDF text extraction completed." if text.strip() else "PDF was readable but no selectable text was found.",
            "pages": len(reader.pages),
        }
    except Exception as error:
        return "", {
            "ready": False,
            "message": f"Failed to extract PDF text: {str(error)}",
            "pages": 0,
        }


def extract_html_text(file_bytes: bytes) -> str:
    raw_html = file_bytes.decode("utf-8", errors="ignore")
    cleaned = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw_html)
    cleaned = re.sub(r"(?is)<style.*?>.*?</style>", " ", cleaned)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    cleaned = cleaned.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_document_text_from_bytes(file_name: str, file_bytes: bytes, mime_type: str | None = None) -> dict[str, Any]:
    suffix = Path(file_name.lower()).suffix
    mime = (mime_type or "").lower()

    if suffix == ".pdf" or "pdf" in mime:
        text, metadata = extract_pdf_text(file_bytes)
        return {
            "documentReady": metadata["ready"],
            "message": metadata["message"],
            "text": text.strip(),
            "format": "pdf",
            "metadata": {"pages": metadata["pages"]},
        }

    if suffix == ".docx" or "wordprocessingml" in mime:
        text = extract_docx_text(file_bytes)
        return {
            "documentReady": bool(text.strip()),
            "message": "DOCX text extraction completed." if text.strip() else "DOCX was readable but no text was found.",
            "text": text.strip(),
            "format": "docx",
            "metadata": {},
        }

    if suffix in {".html", ".htm"} or "html" in mime:
        text = extract_html_text(file_bytes)
        return {
            "documentReady": bool(text.strip()),
            "message": "HTML text extraction completed." if text.strip() else "HTML was readable but no text was found.",
            "text": text.strip(),
            "format": "html",
            "metadata": {},
        }

    if suffix in {".txt", ".md", ".csv"} or mime.startswith("text/"):
        text = file_bytes.decode("utf-8", errors="ignore")
        return {
            "documentReady": bool(text.strip()),
            "message": "Text document extraction completed." if text.strip() else "No text was found in the document.",
            "text": text.strip(),
            "format": "text",
            "metadata": {},
        }

    if mime.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        thresholded = preprocess_image_for_ocr(file_bytes)
        try:
            text = pytesseract.image_to_string(thresholded)
            ready = True
            message = "Image OCR extraction completed."
        except pytesseract.TesseractNotFoundError:
            text = ""
            ready = False
            message = "Tesseract OCR binary is not installed on the host."
        return {
            "documentReady": ready,
            "message": message,
            "text": text.strip(),
            "format": "image",
            "metadata": {"preprocessing": {"shape": list(thresholded.shape), "mode": "grayscale-thresholded"}},
        }

    text = file_bytes.decode("utf-8", errors="ignore")
    return {
        "documentReady": bool(text.strip()),
        "message": "Best-effort text extraction completed." if text.strip() else "Unsupported document type or empty file.",
        "text": text.strip(),
        "format": suffix.lstrip(".") or "unknown",
        "metadata": {},
    }


def preprocess_image_for_ocr(file_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode the supplied image.")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.GaussianBlur(gray, (3, 3), 0)
    thresholded = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return thresholded


def get_reference_library_status() -> dict[str, Any]:
    manifest_path = Path(__file__).parent.parent / "data" / "reference_sources_manifest.json"
    summary = get_catalog_summary()
    metrics = rag_engine.get_reference_library_metrics()
    if not manifest_path.exists():
        return {
            "ready": False,
            "manifestPresent": False,
            "totalReferences": summary["total_references"],
            "indexMetrics": metrics,
        }
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as error:
        return {"ready": False, "manifestPresent": True, "error": str(error), "indexMetrics": metrics}
    return {
        "ready": True,
        "manifestPresent": True,
        "totalReferences": payload.get("total_references"),
        "readyReferences": payload.get("ready_references"),
        "generatedAt": payload.get("generated_at"),
        "indexMetrics": metrics,
    }


def get_reference_library_detail() -> dict[str, Any]:
    manifest_path = Path(__file__).parent.parent / "data" / "reference_sources_manifest.json"
    if not manifest_path.exists():
        return {
            "ready": False,
            "entries": [],
            "summary": {
                "total": 0,
                "complete": 0,
                "textBacked": 0,
                "htmlBacked": 0,
                "metadataBacked": 0,
            },
        }

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    raw_entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
    data_dir = Path(__file__).parent.parent / "data"
    detail_entries: list[dict[str, Any]] = []
    counts = {
        "complete": 0,
        "textBacked": 0,
        "htmlBacked": 0,
        "metadataBacked": 0,
    }

    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        text_path = entry.get("text_path")
        page_path = entry.get("page_path")
        metadata_path = entry.get("metadata_path")
        has_text = isinstance(text_path, str) and (data_dir / text_path).exists()
        has_html = isinstance(page_path, str) and (data_dir / page_path).exists()
        has_metadata = isinstance(metadata_path, str) and (data_dir / metadata_path).exists()
        artifact_origin = "original"
        if has_metadata and isinstance(metadata_path, str):
            try:
                metadata_payload = json.loads((data_dir / metadata_path).read_text(encoding="utf-8"))
                if isinstance(metadata_payload, dict) and metadata_payload.get("artifact_origin") == "synthetic_backfill":
                    artifact_origin = "synthetic_backfill"
            except Exception:
                pass

        if has_text:
            counts["textBacked"] += 1
        if has_html:
            counts["htmlBacked"] += 1
        if has_metadata:
            counts["metadataBacked"] += 1
        if has_text and has_html and has_metadata:
            counts["complete"] += 1

        detail_entries.append(
            {
                "id": str(entry.get("id") or ""),
                "title": str(entry.get("title") or ""),
                "studyTypes": entry.get("study_types") if isinstance(entry.get("study_types"), list) else [],
                "category": str(entry.get("category") or ""),
                "status": str(entry.get("status") or "unknown"),
                "sourceLabel": str(entry.get("source_label") or ""),
                "sourceUrl": str(entry.get("resolved_url") or entry.get("source_url") or ""),
                "hasText": has_text,
                "hasHtml": has_html,
                "hasMetadata": has_metadata,
                "artifactOrigin": artifact_origin,
                "textPath": text_path,
                "htmlPath": page_path,
                "metadataPath": metadata_path,
                "errors": entry.get("errors") if isinstance(entry.get("errors"), list) else [],
            }
        )

    return {
        "ready": True,
        "generatedAt": payload.get("generated_at"),
        "summary": {
            "total": len(detail_entries),
            **counts,
        },
        "entries": detail_entries,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    llm_settings = get_llm_settings()

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
        "openaiConfigured": llm_settings["configured"],
        "openaiModel": llm_settings["model"],
        "llmProvider": llm_settings["provider"],
        "llmBaseUrl": llm_settings["baseUrl"] or "https://api.openai.com/v1",
        "llmKeyPresent": llm_settings["apiKeyPresent"],
        "llmKeyLooksPlaceholder": llm_settings["apiKeyLooksPlaceholder"],
        "mockLLMEnabled": llm_settings["mockEnabled"],
        "mistralConfigured": llm_settings["provider"] == "mistral" and llm_settings["configured"],
        "tesseractConfigured": bool(configured_tesseract_cmd),
        "tesseractCommand": configured_tesseract_cmd,
        "knowledgeCatalog": get_catalog_summary(),
        "referenceLibrary": get_reference_library_status(),
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


@app.get("/knowledge/reference-library-status")
def reference_library_status_detail() -> dict[str, Any]:
    return get_reference_library_detail()


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


@app.post("/dataset/missing-data")
async def dataset_missing_data(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    dataframe = load_dataframe(file.filename, file_bytes)
    cleaned = clean_dataframe(dataframe, {})
    return to_jsonable(analyze_missing_data(cleaned))


@app.post("/document/extract-text")
async def extract_document_text(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    return extract_document_text_from_bytes(
        file_name=file.filename or "uploaded_document",
        file_bytes=file_bytes,
        mime_type=file.content_type,
    )


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
    llm_response = await asyncio.to_thread(try_openai_response, request)
    if llm_response:
        return llm_response
    fallback = build_fallback_assistant_response(request)
    llm_settings = get_llm_settings()
    if llm_settings["apiKeyLooksPlaceholder"]:
        fallback["error"] = "LLM API key is a placeholder; provide a fresh valid key to enable live model responses."
    elif not llm_settings["configured"]:
        fallback["error"] = "LLM is not configured; provide a valid API key or local OpenAI-compatible base URL."
    return fallback


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
    filename = file.filename or "uploaded_doc.txt"
    suffix = Path(filename.lower()).suffix

    if suffix == ".pdf" or "pdf" in (file.content_type or "").lower():
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(file_bytes)
            temp_path = temp_file.name
        try:
            return rag_engine.ingest_pdf_file(
                filepath=temp_path,
                filename=filename,
                document_type=document_type,
                study_type=study_type,
            )
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    extracted = extract_document_text_from_bytes(filename, file_bytes, file.content_type)
    return rag_engine.ingest_text(
        filename=filename,
        text=str(extracted.get("text") or ""),
        document_type=document_type,
        study_type=study_type,
    )


@app.post("/api/v1/reindex-reference-library")
async def reindex_reference_library() -> dict[str, Any]:
    return rag_engine.reload_reference_library()


@app.post("/api/v1/calculate")
async def calculate_sample_size_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    return calculate_sample_size(body)


@app.post("/api/v1/validate")
async def validate_clinical_parameters_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    return validate_clinical_parameters(body)

