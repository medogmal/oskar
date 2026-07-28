# ClinResearch AI — Study-Type-Aware Chatbot Tasks

- `[ ]` **Component 1: Knowledge Catalog (Python)**
  - `[ ]` Create `knowledge_catalog.py` with 126 references + study type mapping
  - `[ ]` Create `prompt_library.py` with study-type-specific prompts
  - `[ ]` Create `knowledge_catalog.json` data file

- `[ ]` **Component 2: Python Analytics Updates**
  - `[ ]` Update `AssistantRequest` model with `study_type` field
  - `[ ]` Update `try_openai_response()` with dynamic system prompt
  - `[ ]` Update `build_fallback_assistant_response()` with study-type context
  - `[ ]` Add `/knowledge/references` endpoint
  - `[ ]` Add `/knowledge/study-types` endpoint

- `[ ]` **Component 3: Backend API (Node.js)**
  - `[ ]` Update `runAssistantChat()` to pass `study_type`
  - `[ ]` Update `buildKnowledgeQueryCandidates()` with study type
  - `[ ]` Update `queryKnowledgeEngineWithFallback()` with study type
  - `[ ]` Add new routes for study-types and references
  - `[ ]` Update `analyticsRoutes.ts`

- `[ ]` **Component 4: Frontend**
  - `[ ]` Create `studyTypes.ts` shared constants
  - `[ ]` Update `Studies.tsx` — dropdown instead of text input
  - `[ ]` Update `AIChat.tsx` — pass study_type and visual indicators

- `[ ]` **Component 5: Tests**
  - `[ ]` Python unit tests for knowledge catalog
  - `[ ]` Python unit tests for prompt library
  - `[ ]` Manual endpoint verification
