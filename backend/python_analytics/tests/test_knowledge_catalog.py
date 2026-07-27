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
from app.clinical_validation import validate_crf_template


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


def test_prompt_library_language_lock():
    """Verify that the prompt builder locks the answer to the user's language."""
    arabic_prompt = build_system_prompt(study_type="rct", mode="researcher_response", response_language="arabic")
    assert "The user asked in Arabic" in arabic_prompt
    assert "MUST answer in Arabic" in arabic_prompt

    english_prompt = build_system_prompt(study_type="rct", mode="researcher_response", response_language="english")
    assert "The user asked in English" in english_prompt
    assert "MUST answer in English" in english_prompt


def test_catalog_summary():
    """Verify summary counts."""
    summary = get_catalog_summary()
    assert summary["total_references"] == 130
    assert "rct" in summary["per_study_type"]


def test_crf_validation_duplicates():
    """Verify validate_crf_template detects duplicate fields."""
    fields = [
        {"label": "Pocket Depth", "responseType": "numeric"},
        {"label": "Pocket Depth", "responseType": "text"}
    ]
    report = validate_crf_template(fields, "rct")
    assert report["valid"] is False
    assert any("تكرار متغير" in err for err in report["errors"])


def test_crf_validation_in_vitro_conflicts():
    """Verify validate_crf_template warns if in_vitro study has patient age/gender."""
    fields = [
        {"label": "Specimen ID", "responseType": "text"},
        {"label": "Patient Age", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "in_vitro")
    assert any("تعارض منطقي" in warn for warn in report["warnings"])


def test_crf_validation_rct_missing_group():
    """Verify validate_crf_template flags RCT without group allocation variable."""
    fields = [
        {"label": "Pocket Depth", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "rct")
    assert report["valid"] is False
    assert any("Group Allocation" in err for err in report["errors"])


def test_crf_validation_sap_compatibility():
    """Verify validate_crf_template warns if numerical outcome exists without group allocation."""
    fields = [
        {"label": "Pocket Depth Value", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "prospective")
    # Should flag a warning for SAP incompatibility
    assert any("خطة التحليل الإحصائي" in warn for warn in report["warnings"])

