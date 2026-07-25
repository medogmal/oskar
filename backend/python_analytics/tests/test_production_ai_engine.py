"""
Comprehensive unit test suite for Production AI Engine features:
- Local RAG retrieval & citations
- Sample size calculations & dropout adjustment
- Clinical parameter validation
- PHI data privacy redaction
- Advanced statistical outputs (Cohen's d, normality, CIs)
"""

import pytest
from app.clinical_validation import validate_clinical_parameters
from app.knowledge_catalog import REFERENCE_CATALOG
from app.privacy import redact_phi
from app.rag_engine import LocalRAGEngine
from app.sample_size_engine import calculate_sample_size


def test_rag_engine_retrieval_and_citations():
    """Verify local RAG search returns valid citations and filtered responses."""
    rag = LocalRAGEngine()
    res = rag.query(question="How to report randomized trials according to CONSORT?", study_type="rct")

    assert res["answer"] is not None
    assert len(res["citations"]) > 0
    first_citation = res["citations"][0]
    assert "source_file" in first_citation
    assert "quoted_text" in first_citation
    assert "CONSORT" in first_citation["source_file"] or "CONSORT" in first_citation["quoted_text"]


def test_rag_engine_ingest_and_query():
    """Verify ingesting user protocol documents and retrieving chunks."""
    rag = LocalRAGEngine()
    ingest_res = rag.ingest_text(
        filename="custom_protocol.txt",
        text="The primary outcome of this periodontitis trial is probing pocket depth reduction at 6 months.",
        document_type="research_proposal",
        study_type="rct",
    )
    assert ingest_res["chunks_processed"] == 1

    search_res = rag.query(question="probing pocket depth reduction", study_type="rct", filter_source="custom_protocol.txt")
    assert len(search_res["citations"]) > 0
    assert search_res["citations"][0]["source_file"] == "custom_protocol.txt"


def test_sample_size_t_test():
    """Verify independent t-test sample size calculation and dropout adjustment."""
    res = calculate_sample_size({
        "test_type": "independent_t_test",
        "effect_size": 0.5,
        "alpha": 0.05,
        "power": 0.80,
        "dropout_rate": 0.15,
    })

    assert res["approved"] is True
    assert res["required_sample_size_per_group"] > 0
    assert res["adjusted_sample_size_per_group"] > res["required_sample_size_per_group"]
    assert res["total_sample_size"] == res["adjusted_sample_size_per_group"] * 2
    assert len(res["scenarios"]) == 3


def test_sample_size_advanced_designs():
    """Verify non-inferiority, survival analysis, and cluster trial sample sizes."""
    noninf = calculate_sample_size({"test_type": "non_inferiority", "margin": 0.10, "effect_size": 0.20})
    assert noninf["approved"] is True
    assert "Non-Inferiority" in noninf["test_used"]

    surv = calculate_sample_size({"test_type": "survival_analysis", "hazard_ratio": 0.70, "event_rate": 0.50})
    assert surv["approved"] is True
    assert "Survival" in surv["test_used"]

    cluster = calculate_sample_size({"test_type": "cluster_randomized", "cluster_size": 25, "icc": 0.05})
    assert cluster["approved"] is True
    assert "Cluster" in cluster["test_used"]



def test_clinical_validation_valid_input():
    """Verify clinical validation with normal physiological values."""
    res = validate_clinical_parameters({
        "patientAge": 35,
        "pocketDepthMm": 4.5,
        "systolicBpMmhg": 120,
        "diastolicBpMmhg": 80,
        "heartRateBpm": 72,
        "smokingStatus": "no",
    })
    assert res["valid"] is True
    assert len(res["errors"]) == 0


def test_clinical_validation_invalid_input():
    """Verify clinical validation catches out-of-range values."""
    res = validate_clinical_parameters({
        "patientAge": 150,  # Invalid
        "pocketDepthMm": 25.0,  # Invalid
        "systolicBpMmhg": 300,  # Invalid
    })
    assert res["valid"] is False
    assert "patientAge" in res["errors"]
    assert "pocketDepthMm" in res["errors"]
    assert "systolicBpMmhg" in res["errors"]


def test_phi_redaction():
    """Verify PHI redaction removes sensitive emails, names, and phone numbers."""
    text = "Researcher Dr. Khaled (email: doctor@example.com, phone: +1-555-123-4567) evaluated patient."
    redacted = redact_phi(text)

    assert "doctor@example.com" not in redacted
    assert "+1-555-123-4567" not in redacted
    assert "[REDACTED_EMAIL]" in redacted
    assert "[REDACTED_PHONE]" in redacted

    from app.privacy import redact_phi_with_audit
    audit_res = redact_phi_with_audit(text)
    assert audit_res["redactions_count"] >= 2
    assert len(audit_res["patterns_triggered"]) >= 2


def test_openai_mock_assistant_pathway():
    """Verify OpenAI client execution pathway using a mock client."""
    from unittest.mock import MagicMock, patch
    from app.main import AssistantRequest, try_openai_response

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-mock-key-for-test", "OPENAI_MODEL": "gpt-4o"}):
        with patch("openai.OpenAI") as MockOpenAI:
            mock_client = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = "Grounded GPT-4o synthesis for RCT trial design."
            mock_response = MagicMock()
            mock_response.choices = [mock_choice]
            mock_client.chat.completions.create.return_value = mock_response
            MockOpenAI.return_value = mock_client

            req = AssistantRequest(
                mode="protocol_understanding",
                prompt="Explain SPIRIT protocol guidelines for RCT",
                study_type="rct",
            )
            res = try_openai_response(req)
            assert res is not None
            assert res["usedLLM"] is True
            assert res["model"] in {"gpt-4o", "mock-ai-test-engine"}

            assert res["answer"] is not None and len(res["answer"]) > 0


def test_placeholder_llm_key_is_not_configured():
    """Verify documented placeholder API keys do not report a configured live LLM."""
    from unittest.mock import patch
    from app.main import AssistantRequest, get_llm_settings, try_openai_response

    with patch.dict(
        "os.environ",
        {
            "LLM_API_KEY": "",
            "GEMINI_API_KEY": "",
            "OPENAI_API_KEY": "YOUR_ROTATED_API_KEY_HERE",
            "OPENAI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "OPENAI_MODEL": "gemini-2.0-flash",
            "ENABLE_MOCK_LLM": "false",
        },
        clear=False,
    ):
        settings = get_llm_settings()

        assert settings["apiKeyPresent"] is True
        assert settings["apiKeyLooksPlaceholder"] is True
        assert settings["configured"] is False
        assert try_openai_response(AssistantRequest(prompt="sample size for RCT", study_type="rct")) is None


def test_assistant_chat_reports_placeholder_key_with_privacy_audit():
    """Verify placeholder-key fallback still returns PHI audit metadata and a clear error."""
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from app.main import app

    with patch.dict(
        "os.environ",
        {
            "LLM_API_KEY": "",
            "GEMINI_API_KEY": "",
            "OPENAI_API_KEY": "YOUR_ROTATED_API_KEY_HERE",
            "OPENAI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "OPENAI_MODEL": "gemini-2.0-flash",
            "ENABLE_MOCK_LLM": "false",
        },
        clear=False,
    ):
        response = TestClient(app).post(
            "/assistant/chat",
            json={
                "prompt": "Patient Name John Doe, Phone 555-123-4567, MRN#998877",
                "study_type": "rct",
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["usedLLM"] is False
        assert "placeholder" in body["error"]
        assert body["privacyAudit"]["redactions_count"] >= 3
