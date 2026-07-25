"""
Unit tests for knowledge catalog and prompt library.
"""

from app.knowledge_catalog import (
    REFERENCE_CATALOG,
    VALID_STUDY_TYPES,
    StudyType,
    get_all_shared_references,
    get_catalog_summary,
    get_reference_ids_for_study_type,
    get_references_for_study_type,
    get_study_type_specific_references,
    is_valid_study_type,
)
from app.prompt_library import build_system_prompt


def test_catalog_total_references():
    """Verify that catalog contains all 130 references."""
    assert len(REFERENCE_CATALOG) == 130, f"Expected 130 references, got {len(REFERENCE_CATALOG)}"


def test_unique_reference_ids():
    """Verify that all reference IDs are unique."""
    ids = [ref["id"] for ref in REFERENCE_CATALOG]
    assert len(ids) == len(set(ids)), f"Duplicate IDs found: {[x for x in ids if ids.count(x) > 1]}"


def test_study_types_validation():
    """Verify valid study type check."""
    for st in ["rct", "prospective", "retrospective", "cross_sectional", "in_vitro"]:
        assert is_valid_study_type(st)
    assert not is_valid_study_type("invalid_type")


def test_rct_references_isolation():
    """Verify RCT gets specific references plus shared ones."""
    rct_refs = get_references_for_study_type("rct")
    rct_ids = [ref["id"] for ref in rct_refs]

    # Must contain SPIRIT and CONSORT
    assert "SPIRIT_2013" in rct_ids
    assert "CONSORT_2010" in rct_ids

    # Must contain shared (like HELSINKI)
    assert "HELSINKI" in rct_ids

    # Must NOT contain In Vitro ISO standards or observational tools
    assert "ISO_4049" not in rct_ids
    assert "AXIS_TOOL" not in rct_ids


def test_in_vitro_references_isolation():
    """Verify In Vitro gets ISO standards and CRIS, but not CONSORT or STROBE."""
    invitro_refs = get_references_for_study_type("in_vitro")
    invitro_ids = [ref["id"] for ref in invitro_refs]

    assert "CRIS_GUIDELINES" in invitro_ids
    assert "ISO_4049" in invitro_ids
    assert "CONSORT_2010" not in invitro_ids
    assert "STROBE_STATEMENT" not in invitro_ids


def test_prompt_library_building():
    """Verify that prompt builder injects study design directives correctly."""
    rct_prompt = build_system_prompt(study_type="rct", mode="protocol_understanding")
    assert "Randomized Controlled Trial" in rct_prompt
    assert "SPIRIT 2013" in rct_prompt

    invitro_prompt = build_system_prompt(study_type="in_vitro", mode="analysis_selection")
    assert "In Vitro Study" in invitro_prompt
    assert "CRIS Guidelines" in invitro_prompt


def test_catalog_summary():
    """Verify summary counts."""
    summary = get_catalog_summary()
    assert summary["total_references"] == 130
    assert summary["shared_references"] == 41
    assert "rct" in summary["per_study_type"]
