# ClinResearch Python Analytics Service

This microservice powers the advanced AI, statistical analytics, RAG knowledge engine, sample size calculator, and clinical validation stack for the ClinResearch AI platform.

## Libraries & Dependencies

- `pandas` for CSV / Excel / SPSS (.sav) data profiling and cleaning
- `SciPy` for classical statistical hypothesis testing (t-tests, Mann-Whitney, Wilcoxon, Shapiro-Wilk, Levene)
- `statsmodels` for regression (linear, logistic), ANOVA, ANCOVA, and survival analysis
- `Plotly` for interactive Plotly White JSON figure generation
- `pyreadstat` for native SPSS (.sav) dataset ingestion
- `OpenCV + pytesseract` for image preprocessing (denoising, thresholding, deskewing) and OCR extraction
- `OpenAI` for GPT-4o powered clinical protocol copilot and evidence-grounded result synthesis

## Installation & Setup

```bash
# Install Python dependencies from backend directory
npm run analytics:install

# Run the service on port 8001
npm run analytics:dev
```

The service runs on `http://127.0.0.1:8001` by default.

## API Endpoints Reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service status, catalog summary, and library versions |
| `/knowledge/study-types` | GET | List valid clinical study types (RCT, Prospective, Retrospective, Cross-Sectional, In Vitro) |
| `/knowledge/references` | GET | List isolated knowledge references filtered by `study_type` |
| `/dataset/profile` | POST | CSV/Excel/SPSS profiling, missing rates, and column types |
| `/analysis/recommend` | POST | Statistical decision engine for automated test selection |
| `/analysis/run` | POST | Execute statistical test with Effect Size, 95% CI, Shapiro-Wilk & Levene checks |
| `/ocr/extract` | POST | OpenCV image thresholding and Tesseract text extraction |
| `/assistant/chat` | POST | GPT-4o copilot with PHI redaction, study-type system prompts, and RAG context |
| `/api/v1/query` | POST | Local RAG knowledge query with inline citations |
| `/api/v1/ingest` | POST | Ingest custom protocol/reference document into RAG index |
| `/api/v1/calculate` | POST | Biostatistical sample size calculation across 9 clinical designs |
| `/api/v1/validate` | POST | Physiological & dental parameter range checks with per-field errors |

## Environment Configuration (`backend/.env`)

- `OPENAI_API_KEY`: Your OpenAI secret key (e.g. `sk-...`).
- `OPENAI_MODEL`: Model name (Default: `gpt-4o`).
- `TESSERACT_CMD`: Path to Tesseract executable (e.g., `C:\Program Files\Tesseract-OCR\tesseract.exe`).
