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
from app.main import handle_missing_data
import pandas as pd
import numpy as np


def test_rag_engine_retrieval_and_citations():
    """Verify local RAG search returns valid citations and filtered responses."""
    rag = LocalRAGEngine()
    res = rag.query(question="How to report randomized trials according to CONSORT?", study_type="rct")

    assert res["answer"] is not None
    assert res["retrieval"]["strategy"] == "semantic_hybrid_vector_database_ranked"
    assert res["retrieval"]["embeddingModel"]
    assert res["retrieval"]["configuredClinicalEmbeddingModel"]
    assert res["retrieval"]["vectorDatabaseBackend"] in {"chroma", "local_json_vector_fallback"}
    assert isinstance(res["retrieval"]["embeddingFallbackApplied"], bool)
    assert len(res["citations"]) > 0
    first_citation = res["citations"][0]
    assert "doc_id" in first_citation
    assert "title" in first_citation
    assert "source_file" in first_citation
    assert "quoted_text" in first_citation
    assert "study_types" in first_citation
    assert "source_backed" in first_citation
    assert "CONSORT" in first_citation["source_file"] or "CONSORT" in first_citation["quoted_text"]


def test_rag_engine_systematic_review_retrieval_isolated():
    """Verify evidence-synthesis RAG queries retrieve systematic-review references."""
    rag = LocalRAGEngine()
    res = rag.query(question="PRISMA protocol registration and risk of bias for systematic review", study_type="systematic_review")

    assert len(res["citations"]) > 0
    citation_ids = {citation["doc_id"] for citation in res["citations"]}
    citation_titles = " ".join(citation["title"] for citation in res["citations"])
    assert "PRISMA_2020" in citation_ids or "PRISMA" in citation_titles
    assert all("in_vitro" not in citation["study_types"] for citation in res["citations"])


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


def test_rag_engine_pdf_ingestion_and_page_citations():
    """Verify page-by-page PDF document ingestion and exact page citations."""
    from pathlib import Path
    pdf_path = Path("D:/Mostaql/oskar/test.pdf")
    if not pdf_path.exists():
        pytest.skip("test.pdf not found in root")

    rag = LocalRAGEngine()
    ingest_res = rag.ingest_pdf_file(pdf_path, study_type="rct")
    assert ingest_res["chunks_processed"] > 0
    assert ingest_res["total_pages"] == 26

    search_res = rag.query(question="diastema closure clear aligners fixed appliances", study_type="rct")
    assert len(search_res["citations"]) > 0
    assert search_res["citations"][0]["source_file"] == "test.pdf"
    assert search_res["citations"][0]["page"] is not None



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


def test_response_language_detection():
    """Verify assistant response language follows the user's question language."""
    from app.main import AssistantRequest, detect_response_language, get_request_response_language

    assert detect_response_language("هل الملف جاهز للنشر؟") == "arabic"
    assert detect_response_language("هل الملف جاهز للنشر؟".encode("utf-8").decode("latin1")) == "arabic"
    assert detect_response_language("Is the manuscript ready for submission?") == "english"
    assert get_request_response_language(AssistantRequest(prompt="Encoding edge case", response_language="arabic")) == "arabic"


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
            assert res["answer"] is not None and len(res["answer"]) > 0


def test_mistral_ai_integration_pathway():
    """Verify Mistral AI provider configuration and endpoint resolution."""
    from unittest.mock import MagicMock, patch
    from app.main import AssistantRequest, get_llm_settings, try_openai_response

    env_overrides = {
        "MISTRAL_API_KEY": "mistral-live-key-1234567890",
        "MISTRAL_MODEL": "mistral-large-latest",
        "OPENAI_API_KEY": "",
        "GEMINI_API_KEY": "",
        "LLM_API_KEY": "",
        "LLM_BASE_URL": "",
        "OPENAI_BASE_URL": "",
        "ENABLE_MOCK_LLM": "false",
    }
    with patch.dict("os.environ", env_overrides, clear=True):
        settings = get_llm_settings()
        assert settings["provider"] == "mistral"
        assert settings["baseUrl"] == "https://api.mistral.ai/v1"
        assert settings["model"] == "mistral-large-latest"
        assert settings["configured"] is True

        with patch("openai.OpenAI") as MockOpenAI:
            mock_client = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = "Mistral AI response synthesis."
            mock_response = MagicMock()
            mock_response.choices = [mock_choice]
            mock_client.chat.completions.create.return_value = mock_response
            MockOpenAI.return_value = mock_client

            req = AssistantRequest(
                mode="protocol_understanding",
                prompt="Explain clinical study protocol using Mistral AI",
                study_type="rct",
            )
            res = try_openai_response(req)
            assert res is not None
            assert res["usedLLM"] is True
            assert res["model"] == "mistral-large-latest"
            assert "Mistral AI response synthesis" in res["answer"]


def test_crf_generation_fallback_layers_and_fields():
    """Verify CRF generation returns extraction, validation, missing data, and renderable fields."""
    from unittest.mock import patch
    from app.main import AssistantRequest, build_fallback_assistant_response

    protocol_text = """
    Study title: Orthodontic alignment trial
    Study type: randomized controlled trial
    Primary outcome: overjet reduction in millimeters at 6 months
    Sample size: 60
    Inclusion criteria: adolescents with Class II malocclusion
    Exclusion criteria: craniofacial anomalies
    Statistical tests: independent t-test
    Randomization method: block randomization
    """
    request = AssistantRequest(
        mode="crf_generation",
        prompt="Generate CRF",
        protocol_text=protocol_text,
        study_type="rct",
        study_context={
            "study_metadata": {
                "title": "Orthodontic alignment trial",
                "studyType": "rct",
                "targetSampleSize": 60,
                "hasRandomization": True,
                "hasBlinding": False,
                "groups": ["Aligner", "Fixed appliance"],
            }
        },
    )

    with patch.dict("os.environ", {"OPENAI_API_KEY": "", "MISTRAL_API_KEY": "", "ENABLE_MOCK_LLM": "false"}, clear=False):
        response = build_fallback_assistant_response(request)

    crf = response["crfResult"]
    assert response["usedLLM"] is False
    assert len(crf["extraction"]) == 23
    assert len(crf["validation"]) >= 7
    assert len(crf["fields"]) >= 20
    assert any(field["section"] == "Occlusion" for field in crf["fields"])
    assert "Blinding not described." in crf["missing_information"]



def test_placeholder_llm_key_is_not_configured():
    """Verify documented placeholder API keys do not report a configured live LLM."""
    from unittest.mock import patch
    from app.main import AssistantRequest, get_llm_settings, try_openai_response

    with patch.dict(
        "os.environ",
        {
            "MISTRAL_API_KEY": "",
            "MISTRAL_MODEL": "",
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
            "MISTRAL_API_KEY": "",
            "MISTRAL_MODEL": "",
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


def test_missing_data_imputation():
    """Verify different missing data handling strategies."""
    data = {
        "score": [10.0, 20.0, np.nan, 40.0],
        "group": ["A", "B", "A", np.nan]
    }
    df = pd.DataFrame(data)
    
    # 1. Complete Case (Listwise deletion)
    res_cc = handle_missing_data(df, "complete_case")
    assert len(res_cc) == 2  # Only row 0 and 1 have no NaNs
    
    # 2. Mean Imputation
    res_mean = handle_missing_data(df, "mean_imputation")
    assert len(res_mean) == 4
    assert res_mean["score"].iloc[2] == 23.333333333333332  # Mean of 10, 20, 40
    
    # 3. Median Imputation
    res_median = handle_missing_data(df, "median_imputation")
    assert res_median["score"].iloc[2] == 20.0  # Median of 10, 20, 40
    
    # 4. Mode Imputation
    res_mode = handle_missing_data(df, "mode_imputation")
    assert res_mode["group"].iloc[3] == "A"  # Mode of group is "A"

