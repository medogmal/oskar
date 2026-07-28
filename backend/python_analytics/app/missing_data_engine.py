from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _classify_missingness(missing_pct: float, relationships: list[float]) -> tuple[str, float]:
    max_relationship = max(relationships) if relationships else 0.0
    if missing_pct == 0:
        return "MCAR", 0.99
    if missing_pct >= 30 and max_relationship < 0.12:
        return "MNAR", min(0.9, 0.58 + (missing_pct / 100.0))
    if max_relationship >= 0.18:
        return "MAR", min(0.92, 0.55 + max_relationship)
    return "MCAR", min(0.88, 0.6 + (0.12 - max_relationship))


def choose_missing_data_method(pattern: str, missing_pct: float, longitudinal: bool = False) -> dict[str, Any]:
    pattern = str(pattern).upper()
    if missing_pct <= 1:
        return {
            "code": "none",
            "label": "No action needed",
            "justification": "Missingness is negligible and can be retained as-is for descriptive profiling.",
            "sensitivity_analysis": "Not required.",
        }

    if pattern == "MCAR" and missing_pct < 5:
        return {
            "code": "complete_case",
            "label": "Complete Case Analysis",
            "justification": "Low-rate MCAR missingness is usually acceptable for complete-case analysis.",
            "sensitivity_analysis": "Compare complete-case counts versus full cohort counts.",
        }

    if pattern == "MAR":
        return {
            "code": "mice",
            "label": "Multiple Imputation by Chained Equations (MICE)",
            "justification": "MAR patterns should prefer multiple imputation using predictors related to missingness.",
            "sensitivity_analysis": "Run delta-adjustment or best/worst-case sensitivity analysis.",
        }

    if pattern == "MNAR":
        return {
            "code": "sensitivity",
            "label": "Sensitivity Analysis + Controlled Imputation",
            "justification": "MNAR missingness requires explicit sensitivity analysis because the mechanism is informative.",
            "sensitivity_analysis": "Tipping-point, delta-adjustment, and scenario-based worst/best-case analyses.",
        }

    return {
        "code": "locf" if longitudinal else "mean",
        "label": "LOCF" if longitudinal else "Mean / Median Imputation",
        "justification": "Fallback strategy for simple operational cleanup when advanced imputation is unavailable.",
        "sensitivity_analysis": "Validate against complete-case and multiple-imputation alternatives.",
    }


def analyze_missing_data(dataframe: pd.DataFrame) -> dict[str, Any]:
    rows = int(len(dataframe))
    columns = []
    heatmap = []
    total_missing = int(dataframe.isna().sum().sum())

    for row_idx, (_, row) in enumerate(dataframe.head(100).iterrows()):
        heatmap.append([1 if pd.isna(value) else 0 for value in row.tolist()])

    for column in dataframe.columns:
        series = dataframe[column]
        missing_indicator = series.isna().astype(int)
        missing_count = int(missing_indicator.sum())
        missing_pct = float((missing_count / rows) * 100) if rows else 0.0
        if missing_count == 0:
            relationships: list[float] = []
        else:
            relationships = []
            for other in dataframe.columns:
                if other == column:
                    continue
                other_series = dataframe[other]
                if pd.api.types.is_numeric_dtype(other_series):
                    candidate = other_series.fillna(other_series.median() if other_series.notna().any() else 0)
                    corr = abs(_safe_float(np.corrcoef(missing_indicator, candidate)[0, 1])) if len(candidate) > 1 else 0.0
                    if np.isfinite(corr):
                        relationships.append(corr)
                else:
                    candidate = other_series.fillna("__missing__").astype("category").cat.codes
                    corr = abs(_safe_float(np.corrcoef(missing_indicator, candidate)[0, 1])) if len(candidate) > 1 else 0.0
                    if np.isfinite(corr):
                        relationships.append(corr)

        pattern, confidence = _classify_missingness(missing_pct, relationships)
        recommendation = choose_missing_data_method(pattern, missing_pct)
        columns.append(
            {
                "column": str(column),
                "missingCount": missing_count,
                "missingPercentage": round(missing_pct, 2),
                "patternClassification": pattern,
                "classificationConfidence": round(confidence, 3),
                "recommendedTreatment": recommendation["label"],
                "recommendedTreatmentCode": recommendation["code"],
                "justification": recommendation["justification"],
                "sensitivityAnalysis": recommendation["sensitivity_analysis"],
                "topCorrelationWithMissingness": round(max(relationships) if relationships else 0.0, 3),
            }
        )

    summary = {
        "rows": rows,
        "columns": int(len(dataframe.columns)),
        "totalMissingCells": total_missing,
        "overallMissingPercentage": round((total_missing / max(1, rows * max(1, len(dataframe.columns)))) * 100, 2),
        "mcarColumns": sum(1 for item in columns if item["patternClassification"] == "MCAR"),
        "marColumns": sum(1 for item in columns if item["patternClassification"] == "MAR"),
        "mnarColumns": sum(1 for item in columns if item["patternClassification"] == "MNAR"),
    }

    overall_pattern = "MNAR" if summary["mnarColumns"] else "MAR" if summary["marColumns"] else "MCAR"
    overall_recommendation = choose_missing_data_method(overall_pattern, summary["overallMissingPercentage"], longitudinal=True)

    return {
        "analysis": "missing_data",
        "summary": summary,
        "columnsAnalysis": columns,
        "heatmap": {
            "columns": [str(column) for column in dataframe.columns.tolist()],
            "rows": heatmap,
        },
        "overallPattern": overall_pattern,
        "overallRecommendation": overall_recommendation,
    }
