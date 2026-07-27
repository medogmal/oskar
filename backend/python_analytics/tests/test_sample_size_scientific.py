"""
ClinResearch AI — Scientific Sample Size Validation Unit Tests
================================================================
Validates mathematical calculations against standard reference texts:
- Chow et al. (2017) "Sample Size Calculations in Clinical Research"
- Rosner (2015) "Fundamentals of Biostatistics"
"""

import math
import pytest
from app.sample_size_engine import calculate_sample_size


def test_independent_t_test_reference_calculation():
    """Verify independent two-sample t-test with alpha=0.05, power=0.80, effect_size=0.50."""
    result = calculate_sample_size({
        "test_type": "independent_t_test",
        "alpha": 0.05,
        "power": 0.80,
        "effect_size": 0.50,
        "dropout_rate": 0.0,
    })
    
    assert result["approved"] is True
    # Reference value: 63 per group, total 126
    assert result["required_sample_size_per_group"] == 63
    assert result["total_sample_size"] == 126


def test_cluster_rct_design_effect():
    """Verify Cluster RCT design effect multiplier DEFF = 1 + (m-1)*ICC."""
    result = calculate_sample_size({
        "test_type": "cluster_randomized",
        "alpha": 0.05,
        "power": 0.80,
        "effect_size": 0.50,
        "cluster_size": 20,
        "icc": 0.05,
        "dropout_rate": 0.0,
    })
    
    # Base n = 126 unclustered, DEFF = 1 + 19 * 0.05 = 1.95
    # Clustered total = ceil(125.58 * 1.95) = 246
    assert result["approved"] is True
    assert result["total_sample_size"] >= 240
    assert "DEFF=1.95" in result["formula_used"]


def test_survival_analysis_schoenfeld_events():
    """Verify Log-Rank Survival Analysis required events for HR=0.70."""
    result = calculate_sample_size({
        "test_type": "survival_analysis",
        "alpha": 0.05,
        "power": 0.80,
        "hazard_ratio": 0.70,
        "event_rate": 0.50,
        "dropout_rate": 0.0,
    })
    
    assert result["approved"] is True
    assert "Events=247" in result["formula_used"]
    assert result["total_sample_size"] >= 490


def test_non_inferiority_margin_calculation():
    """Verify Non-inferiority trial sample size for margin=0.10."""
    result = calculate_sample_size({
        "test_type": "non_inferiority",
        "alpha": 0.05,
        "power": 0.80,
        "effect_size": 0.0,
        "margin": 0.10,
        "dropout_rate": 0.0,
    })
    
    assert result["approved"] is True
    assert result["required_sample_size_per_group"] > 1000
    assert "Non-Inferiority Trial" in result["test_used"]
