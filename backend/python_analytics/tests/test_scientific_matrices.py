"""
Auditable data-matrix tests for statistical selection and variable classification.
"""

import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "matrices"


def test_statistical_test_selection_matrix_json():
    matrix = json.loads((DATA_DIR / "statistical_test_selection_matrix.json").read_text(encoding="utf-8"))
    rule_ids = {rule["id"] for rule in matrix["rules"]}

    assert matrix["version"]
    assert "continuous_two_independent_groups_parametric" in rule_ids
    assert "binary_two_or_more_groups" in rule_ids
    assert "meta_analysis_effect_pooling" in rule_ids
    assert all(rule.get("recommendedTest") for rule in matrix["rules"])


def test_variable_classification_tree_json():
    tree = json.loads((DATA_DIR / "variable_classification_tree.json").read_text(encoding="utf-8"))
    node_ids = {node["id"] for node in tree["nodes"]}

    assert tree["version"]
    assert "outcome_primary" in node_ids
    assert "outcome_secondary" in node_ids
    assert "evidence_synthesis_extraction" in node_ids
    primary = next(node for node in tree["nodes"] if node["id"] == "outcome_primary")
    assert primary["requiresResearchQuestionLink"] is True
    assert primary["requiresObjectiveLink"] is True
    assert primary["requiresStatisticalTest"] is True
