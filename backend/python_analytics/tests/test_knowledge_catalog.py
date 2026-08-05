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
    """Verify that catalog contains the expanded 140-reference set."""
    assert len(REFERENCE_CATALOG) == 140, f"Expected 140 references, got {len(REFERENCE_CATALOG)}"


def test_unique_reference_ids():
    """Verify that all reference IDs are unique."""
    ids = [ref["id"] for ref in REFERENCE_CATALOG]
    assert len(ids) == len(set(ids)), f"Duplicate IDs found: {[x for x in ids if ids.count(x) > 1]}"


def test_study_types_validation():
    """Verify valid study type check."""
    for st in ["rct", "prospective", "retrospective", "cross_sectional", "in_vitro", "systematic_review", "meta_analysis"]:
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


def test_evidence_synthesis_references_isolation():
    """Verify systematic review and meta-analysis references are isolated by study type."""
    systematic_ids = get_reference_ids_for_study_type("systematic_review")
    meta_ids = get_reference_ids_for_study_type("meta_analysis")

    assert "PRISMA_2020" in systematic_ids
    assert "AMSTAR2" in systematic_ids
    assert "ROBIS" in systematic_ids
    assert "MOOSE_GUIDELINES" not in systematic_ids

    assert "PRISMA_2020" in meta_ids
    assert "MOOSE_GUIDELINES" in meta_ids
    assert "PRISMA_NMA" in meta_ids
    assert "PUBLICATION_BIAS_TESTS" in meta_ids
    assert "ISO_4049" not in meta_ids


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
    assert summary["total_references"] == 140
    assert "rct" in summary["per_study_type"]
    assert summary["per_study_type"]["systematic_review"]["specific"] > 0
    assert summary["per_study_type"]["meta_analysis"]["specific"] > 0


def test_crf_validation_duplicates():
    """Verify validate_crf_template detects duplicate fields."""
    fields = [
        {"label": "Pocket Depth", "responseType": "numeric"},
        {"label": "Pocket Depth", "responseType": "text"}
    ]
    report = validate_crf_template(fields, "rct")
    assert report["valid"] is False
    assert any(issue["code"] == "CRF_DUPLICATE_VARIABLE" for issue in report["issues"])


def test_crf_validation_in_vitro_conflicts():
    """Verify validate_crf_template warns if in_vitro study has patient age/gender."""
    fields = [
        {"label": "Specimen ID", "responseType": "text"},
        {"label": "Patient Age", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "in_vitro")
    assert any(issue["code"] == "IN_VITRO_PATIENT_DEMOGRAPHICS" for issue in report["issues"])


def test_crf_validation_rct_missing_group():
    """Verify validate_crf_template flags RCT without group allocation variable."""
    fields = [
        {"label": "Pocket Depth", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "rct")
    assert report["valid"] is False
    assert any(issue["code"] == "GROUP_ALLOCATION_MISSING" for issue in report["issues"])


def test_crf_validation_sap_compatibility():
    """Verify validate_crf_template warns if numerical outcome exists without group allocation."""
    fields = [
        {"label": "Pocket Depth Value", "responseType": "numeric"}
    ]
    report = validate_crf_template(fields, "prospective")
    # Should flag a warning for SAP incompatibility
    assert any(issue["code"] == "SAP_GROUPING_MISMATCH" for issue in report["issues"])


def test_crf_validation_metadata_and_objective_links():
    """Verify outcome variables require source/method/unit/RQ/objective/statistical-test metadata."""
    fields = [
        {
            "id": "pd_6m",
            "label": "Pocket Depth at 6 months",
            "responseType": "numeric",
            "role": "primary_outcome",
            "scale": "ratio",
        }
    ]
    report = validate_crf_template(
        fields,
        "rct",
        objectives=[{"id": "obj1"}],
        research_questions=[{"id": "rq1"}],
    )
    codes = {issue["code"] for issue in report["issues"]}

    assert report["valid"] is False
    assert "VARIABLE_SOURCE_MISSING" in codes
    assert "MEASUREMENT_METHOD_MISSING" in codes
    assert "VARIABLE_UNIT_MISSING" in codes
    assert "OUTCOME_NOT_LINKED_TO_RESEARCH_QUESTION" in codes
    assert "OUTCOME_NOT_LINKED_TO_OBJECTIVE" in codes
    assert "STATISTICAL_TEST_MISSING" in codes


def test_crf_validation_conflicting_variable_definitions():
    """Verify CRF validation detects non-duplicate conflicting definitions."""
    fields = [
        {
            "id": "pd_mm",
            "label": "Pocket Depth",
            "responseType": "numeric",
            "scale": "ratio",
            "unit": "mm",
            "source": "clinical_examination",
            "measurementMethod": "Periodontal probe at six sites",
        },
        {
            "id": "pd_cm",
            "label": "Pocket Depth Value",
            "responseType": "numeric",
            "scale": "ratio",
            "unit": "cm",
            "source": "clinical_examination",
            "measurementMethod": "Periodontal probe at six sites",
        },
    ]
    report = validate_crf_template(fields, "retrospective")
    assert any(issue["code"] == "CRF_VARIABLE_CONFLICT" for issue in report["issues"])

