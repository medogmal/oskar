import json
import os
import sys

# Add python_analytics to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../backend/python_analytics')))

from app.knowledge_catalog import REFERENCE_CATALOG, STUDY_TYPE_LABELS, VALID_STUDY_TYPES
from app.clinical_validation import RANGE_RULES
from app.prompt_library import STUDY_TYPE_DIRECTIVES, MODE_DIRECTIVES, BASE_SYSTEM_PROMPT

output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../deliverables_json'))
os.makedirs(output_dir, exist_ok=True)

# 1. Export Knowledge Catalog
with open(os.path.join(output_dir, 'knowledge_catalog.json'), 'w', encoding='utf-8') as f:
    json.dump({
        "study_type_labels": STUDY_TYPE_LABELS,
        "valid_study_types": VALID_STUDY_TYPES,
        "references": REFERENCE_CATALOG
    }, f, ensure_ascii=False, indent=2)

# 2. Export Clinical Rules & Error Severity Catalog
with open(os.path.join(output_dir, 'clinical_rules_severity.json'), 'w', encoding='utf-8') as f:
    json.dump({
        "description": "Standard Clinical & Physiological Range Rules with Severity Tags",
        "rules": RANGE_RULES
    }, f, ensure_ascii=False, indent=2)

# 3. Export Prompt Library
with open(os.path.join(output_dir, 'prompt_library.json'), 'w', encoding='utf-8') as f:
    json.dump({
        "base_system_prompt": BASE_SYSTEM_PROMPT,
        "study_type_directives": STUDY_TYPE_DIRECTIVES,
        "mode_directives": MODE_DIRECTIVES
    }, f, ensure_ascii=False, indent=2)

# 4. Export Statistical Decision Trees Metadata
decision_tree_meta = {
    "study_design_classification_tree": {
        "root": "Is clinical trial or observational?",
        "nodes": {
            "clinical_trial": {
                "question": "Is randomization used?",
                "yes": "RCT",
                "no": "Non-Randomized Clinical Trial"
            },
            "observational": {
                "question": "Is there a follow-up period?",
                "yes": {
                    "question": "Is data collected forward in time?",
                    "yes": "Prospective Cohort Study",
                    "no": "Retrospective Study"
                },
                "no": "Cross-Sectional Study"
            }
        }
    },
    "sample_size_decision_tree": {
        "independent_t_test": {
            "formula": "n = 2 * ((z_alpha + z_beta) / d)^2",
            "required_parameters": ["alpha", "power", "effect_size", "ratio"],
            "description": "Used for comparing two independent group means."
        },
        "paired_t_test": {
            "formula": "n = ((z_alpha + z_beta) / d)^2",
            "required_parameters": ["alpha", "power", "effect_size"],
            "description": "Used for comparing matched pairs or pre/post test means."
        },
        "two_proportion_z_test": {
            "formula": "n = (z_alpha * sqrt(2*p_bar*q_bar) + z_beta * sqrt(p1*q1 + p2*q2))^2 / diff^2",
            "required_parameters": ["alpha", "power", "p1", "p2"],
            "description": "Used for comparing two independent group proportions."
        },
        "anova": {
            "formula": "n = ((z_alpha + z_beta) / f)^2 / (2 * k) + 2",
            "required_parameters": ["alpha", "power", "effect_size", "k_groups"],
            "description": "Used for comparing three or more independent group means."
        },
        "repeated_measures_anova": {
            "formula": "n = ((z_alpha + z_beta) / f)^2 * (1 - corr) / k + 3",
            "required_parameters": ["alpha", "power", "effect_size", "measures_count", "correlation"],
            "description": "Used for comparing means of same subjects measured repeatedly."
        }
    }
}

with open(os.path.join(output_dir, 'decision_trees.json'), 'w', encoding='utf-8') as f:
    json.dump(decision_tree_meta, f, ensure_ascii=False, indent=2)

print(f"Exported JSON files to {output_dir}")
