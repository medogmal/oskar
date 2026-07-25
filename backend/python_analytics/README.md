# ClinResearch Python Analytics

This service powers the advanced analytics stack for the clinical research platform.

## Libraries

- `pandas` for CSV / Excel / SPSS profiling and cleaning
- `SciPy` for classical statistical testing
- `statsmodels` for regression, ANOVA, ANCOVA, and survival-ready analysis
- `Plotly` for interactive figures
- `pyreadstat` for `.sav` files
- `OpenCV + pytesseract` for OCR preprocessing and extraction
- `OpenAI` for GPT-driven protocol understanding and result explanation when `OPENAI_API_KEY` is configured

## Install

```bash
npm run analytics:install
```

## Run

```bash
npm run analytics:dev
```

The service runs on `http://127.0.0.1:8001` by default.

## Notes

- OCR preprocessing works immediately after Python dependencies are installed.
- Full OCR text extraction additionally requires the `Tesseract OCR` system binary to be installed and available on the host.
- GPT integration works when `OPENAI_API_KEY` is set in `backend/.env`.
- Default model is `gpt-5.5`, configurable through `OPENAI_MODEL`.
