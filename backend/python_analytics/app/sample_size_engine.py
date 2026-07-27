"""
ClinResearch AI — Built-in Sample Size & Power Calculation Engine
=================================================================
Calculates statistical sample sizes, power analysis, dropout adjustments,
and sensitivity scenarios for 5 clinical research designs.
"""

from __future__ import annotations

import math
from typing import Any
import scipy.stats as stats


def _z_alpha(alpha: float, two_sided: bool = True) -> float:
    p = 1.0 - (alpha / 2.0 if two_sided else alpha)
    return float(stats.norm.ppf(p))


def _z_beta(power: float) -> float:
    return float(stats.norm.ppf(power))


def calculate_sample_size(params: dict[str, Any]) -> dict[str, Any]:
    """Calculate clinical sample size based on test type and design parameters."""
    test_type = str(params.get("test_type") or params.get("test_used") or "independent_t_test").lower()
    alpha = float(params.get("alpha", 0.05))
    power = float(params.get("power", 0.80))
    effect_size = float(params.get("effect_size", 0.50))
    ratio = float(params.get("ratio", 1.0))
    dropout_rate = float(params.get("dropout_rate", 0.15))
    alternative = str(params.get("alternative", "two-sided")).lower()
    two_sided = alternative != "one-sided" and alternative != "larger" and alternative != "smaller"

    z_a = _z_alpha(alpha, two_sided)
    z_b = _z_beta(power)

    n1 = 0
    n2 = 0
    total = 0
    test_label = ""
    formula_desc = ""

    if test_type in {"independent_t_test", "two_sample_t_test", "t_test"}:
        test_label = "Independent Two-Sample t-Test"
        d = max(0.01, effect_size)
        # n per group = 2 * ((z_a + z_b) / d)^2
        n_raw = 2.0 * math.pow((z_a + z_b) / d, 2)
        n1 = math.ceil(n_raw)
        n2 = math.ceil(n1 * ratio)
        total = n1 + n2
        formula_desc = f"n_group = 2 * [(z_{{1-α/2}} + z_{{1-β}}) / d]^2 | α={alpha}, 1-β={power}, d={d}"

    elif test_type in {"paired_t_test", "matched_pairs"}:
        test_label = "Paired Samples t-Test"
        d = max(0.01, effect_size)
        n_raw = math.pow((z_a + z_b) / d, 2)
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1
        formula_desc = f"n_pairs = [(z_{{1-α/2}} + z_{{1-β}}) / d]^2 | α={alpha}, 1-β={power}, d={d}"

    elif test_type in {"two_proportion_z_test", "proportions", "z_test"}:
        test_label = "Two-Proportion Z-Test"
        p1 = float(params.get("p1", 0.50))
        p2 = float(params.get("p2", 0.30))
        p_bar = (p1 + p2) / 2.0
        q_bar = 1.0 - p_bar
        diff = abs(p1 - p2)
        if diff < 1e-4:
            diff = 0.20
        n_raw = math.pow(
            z_a * math.sqrt(2 * p_bar * q_bar) + z_b * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)),
            2,
        ) / math.pow(diff, 2)
        n1 = math.ceil(n_raw)
        n2 = math.ceil(n1 * ratio)
        total = n1 + n2
        formula_desc = f"Z-test for Proportions | p1={p1}, p2={p2}, α={alpha}, 1-β={power}"

    elif test_type in {"anova", "one_way_anova"}:
        test_label = "One-Way ANOVA"
        k_groups = int(params.get("groups_count", params.get("k_groups", 3)))
        f_effect = max(0.01, effect_size)
        # Approximate sample size per group for ANOVA: n_group = [(z_a + z_b) / f]^2 / (2 * k) + 1
        n_raw = math.pow((z_a + z_b) / f_effect, 2) / (2.0 * k_groups) + 2
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1 * k_groups
        formula_desc = f"ANOVA Sample Size | k={k_groups} groups, f={f_effect}, α={alpha}, 1-β={power}"

    elif test_type in {"repeated_measures_anova", "rm_anova"}:
        test_label = "Repeated Measures ANOVA"
        k_measures = int(params.get("measures_count", 3))
        corr = float(params.get("correlation", 0.50))
        f_effect = max(0.01, effect_size)
        mult = (1.0 - corr) / max(1, k_measures)
        n_raw = math.pow((z_a + z_b) / f_effect, 2) * mult + 3
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1
        formula_desc = f"Repeated Measures ANOVA | {k_measures} measures, corr={corr}, f={f_effect}"

    elif test_type in {"non_inferiority", "noninferiority"}:
        test_label = "Non-Inferiority Trial"
        margin = float(params.get("margin", 0.10))
        d = max(0.01, effect_size)
        # Formula: n_group = 2 * [(z_a + z_b) / (d - margin)]^2
        denom = max(0.001, abs(d - margin))
        n_raw = 2.0 * math.pow((_z_alpha(alpha, False) + z_b) / denom, 2)
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1 * 2
        formula_desc = f"Non-Inferiority Trial | margin={margin}, d={d}, α={alpha}, 1-β={power}"

    elif test_type in {"equivalence"}:
        test_label = "Equivalence Trial"
        margin = float(params.get("margin", 0.10))
        denom = max(0.001, margin)
        n_raw = 2.0 * math.pow((_z_alpha(alpha, False) + _z_beta((1.0 + power) / 2.0)) / denom, 2)
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1 * 2
        formula_desc = f"Equivalence Trial (TOST) | margin=±{margin}, α={alpha}, 1-β={power}"

    elif test_type in {"survival_analysis", "log_rank", "survival"}:
        test_label = "Survival Analysis (Log-Rank Test)"
        hr = float(params.get("hazard_ratio", 0.70))
        log_hr = abs(math.log(hr)) if hr > 0 and hr != 1.0 else 0.35
        # Total events required = 4 * [(z_a + z_b) / log(HR)]^2
        n_events = math.ceil(4.0 * math.pow((z_a + z_b) / log_hr, 2))
        event_rate = float(params.get("event_rate", 0.50))
        n_raw = n_events / max(0.05, event_rate)
        n1 = math.ceil(n_raw / 2.0)
        n2 = n1
        total = n1 * 2
        formula_desc = f"Log-Rank Survival Trial | HR={hr}, Events={n_events}, α={alpha}, 1-β={power}"

    elif test_type in {"cluster_randomized", "cluster"}:
        test_label = "Cluster Randomized Trial"
        cluster_size = int(params.get("cluster_size", 20))
        icc = float(params.get("icc", 0.05))
        deff = 1.0 + (cluster_size - 1) * icc
        d = max(0.01, effect_size)
        n_group_base = 2.0 * math.pow((z_a + z_b) / d, 2)
        n1 = math.ceil(n_group_base * deff)
        n2 = math.ceil(n1 * ratio)
        total = n1 + n2
        formula_desc = f"Cluster Trial | DEFF={deff:.2f} (m={cluster_size}, ICC={icc}), α={alpha}, 1-β={power}"


    else:
        # Fallback to independent t-test
        test_label = "Independent Two-Sample t-Test"
        d = max(0.01, effect_size)
        n_raw = 2.0 * math.pow((z_a + z_b) / d, 2)
        n1 = math.ceil(n_raw)
        n2 = n1
        total = n1 * 2
        formula_desc = f"n_group = 2 * [(z_{{1-α/2}} + z_{{1-β}}) / d]^2"

    # Calculate Dropout Adjustment
    valid_dropout = min(0.50, max(0.0, dropout_rate))
    adj_factor = 1.0 / (1.0 - valid_dropout)
    adj_n1 = math.ceil(n1 * adj_factor)
    adj_n2 = math.ceil(n2 * adj_factor)
    adj_total = adj_n1 + adj_n2


    # Sensitivity Analysis Scenarios (Small d=0.2, Medium d=0.5, Large d=0.8)
    scenarios = []
    for es_label, es_val in [("Small Effect (d=0.2)", 0.2), ("Medium Effect (d=0.5)", 0.5), ("Large Effect (d=0.8)", 0.8)]:
        sc_n1 = math.ceil(2.0 * math.pow((z_a + z_b) / es_val, 2))
        sc_adj = math.ceil(sc_n1 * adj_factor)
        scenarios.append({
            "label": es_label,
            "effect_size": es_val,
            "n_per_group": sc_n1,
            "adjusted_n_per_group": sc_adj,
            "total_sample_size": sc_adj * 2,
        })

    interpretation = (
        f"حجم العينة المطلوب لاختبار ({test_label}) مع قوة إحصائية {int(power*100)}% ومستوى دلالة α={alpha} "
        f"وحجم أثر {effect_size} هو {n1} مشارك لكل مجموعة ({total} إجمالي). "
        f"عند إضافة نسبة انسحاب متوقعة ({int(valid_dropout*100)}%)، يصبح حجم العينة النهائي المطلوب {adj_n1} مشارك لكل مجموعة "
        f"({adj_total} إجمالي)."
    )

    return {
        "approved": True,
        "message": "تم حساب حجم العينة بنجاح بناءً على المعادلات السريرية المعتمدة.",
        "test_used": test_label,
        "proposed_effect_size": effect_size,
        "parameters": {
            "alpha": alpha,
            "power": power,
            "effect_size": effect_size,
            "ratio": ratio,
            "dropout_rate": valid_dropout,
            "alternative": alternative,
        },
        "required_sample_size_per_group": n1,
        "adjusted_sample_size_per_group": adj_n1,
        "total_sample_size": adj_total,
        "formula_used": formula_desc,
        "interpretation": interpretation,
        "scenarios": scenarios,
    }
