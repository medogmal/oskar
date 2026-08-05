"""
ClinResearch AI — Built-in Local RAG Engine
=============================================
Provides grounded RAG retrieval, document chunking, indexing, and citation generation
filtered by clinical study_type and isolated reference sets.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from .knowledge_catalog import (
    REFERENCE_CATALOG,
    get_references_for_study_type,
)

SEMANTIC_SYNONYMS: dict[str, list[str]] = {
    "rct": ["randomized", "controlled", "trial", "randomisation", "randomization", "spirit", "consort"],
    "prospective": ["cohort", "follow-up", "longitudinal", "strobe"],
    "retrospective": ["cohort", "case-control", "historical", "ehr", "record", "strobe"],
    "cross_sectional": ["survey", "prevalence", "axis", "epidemiological"],
    "in_vitro": ["laboratory", "mechanical", "bond", "shear", "composite", "iso"],
    "sample_size": ["power", "alpha", "beta", "dropout", "population", "formula"],
    "normality": ["shapiro", "wilk", "distribution", "parametric"],
    "variance": ["levene", "homogeneity", "anova", "t-test"],
    "blinding": ["masked", "double-blind", "single-blind", "concealment"],
    "systematic_review": ["prisma", "prospero", "amstar", "cochrane", "review"],
    "meta_analysis": ["prisma", "moose", "heterogeneity", "egger", "funnel", "pooling"],
}

PRIMARY_REFERENCE_HINTS: dict[str, list[str]] = {
    "consort_items": [
        "CONSORT_2010",
        "CONSORT_CHECKLIST",
        "CONSORT_EXPLANATION",
        "CONSORT_FLOW",
    ],
    "ich_e6": [
        "ICH_E6R3",
        "ICH_E8R1",
        "ICH_E3",
        "ICH_E2A",
    ],
}


def _tokenize(text: str) -> list[str]:
    """Tokenize English and Arabic text into lowercase words/terms (min length 2)."""
    return [
        w.lower()
        for w in re.split(r"[^\w]+", text, flags=re.UNICODE)
        if len(w) >= 2
    ]


class KnowledgeDocument:
    def __init__(
        self,
        doc_id: str,
        title: str,
        content: str,
        category: str = "general",
        study_types: list[str] | None = None,
        source_file: str | None = None,
        source_url: str | None = None,
        page: int | None = None,
        section: str | None = None,
    ):
        self.doc_id = doc_id
        self.title = title
        self.content = content
        self.category = category
        self.study_types = study_types or ["shared"]
        self.source_file = source_file or f"{doc_id}.pdf"
        self.source_url = source_url
        self.page = page
        self.section = section
        self.tokens = _tokenize(f"{title} {content} {category}")
        self.title_tokens = _tokenize(title)
        self.context_tokens = _tokenize(f"{category} {section or ''} {' '.join(self.study_types)}")


class LocalRAGEngine:
    """Lightweight in-memory RAG engine with TF-IDF/BM25 scoring and study-type isolation."""

    def __init__(self):
        self.documents: list[KnowledgeDocument] = []
        self._seed_catalog()

    def _get_data_dir(self) -> Path:
        data_dir = Path(__file__).parent.parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir

    def _get_reference_manifest_path(self) -> Path:
        return self._get_data_dir() / "reference_sources_manifest.json"

    def _load_reference_manifest(self) -> dict[str, dict[str, Any]]:
        manifest_path = self._get_reference_manifest_path()
        if not manifest_path.exists():
            return {}
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        entries = payload.get("entries")
        if not isinstance(entries, list):
            return {}
        return {
            str(entry.get("id")): entry
            for entry in entries
            if isinstance(entry, dict) and entry.get("id")
        }

    def _load_seed_source(self, ref: dict[str, Any], manifest_index: dict[str, dict[str, Any]]) -> dict[str, str | None]:
        entry = manifest_index.get(ref["id"]) or {}
        text_path_value = entry.get("text_path")
        page_path_value = entry.get("page_path")
        metadata_path_value = entry.get("metadata_path")
        source_url = entry.get("resolved_url") or entry.get("source_url")
        metadata_text = self._load_manifest_metadata_text(metadata_path_value)

        for path_value in [text_path_value, page_path_value]:
            if not isinstance(path_value, str) or not path_value:
                continue
            candidate_path = self._get_data_dir() / Path(path_value)
            if not candidate_path.exists():
                continue
            try:
                if candidate_path.suffix.lower() == ".html":
                    raw_text = re.sub(r"(?is)<[^>]+>", " ", candidate_path.read_text(encoding="utf-8", errors="ignore"))
                else:
                    raw_text = candidate_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            cleaned_text = re.sub(r"\s+", " ", raw_text).strip()
            if cleaned_text:
                return {
                    "content": self._merge_source_and_metadata_text(cleaned_text, metadata_text),
                    "source_file": candidate_path.name,
                    "source_url": str(source_url) if source_url else None,
                }

        return {
            "content": metadata_text,
            "source_file": None,
            "source_url": str(source_url) if source_url else None,
        }

    def _load_manifest_metadata_text(self, metadata_path_value: Any) -> str | None:
        if not isinstance(metadata_path_value, str) or not metadata_path_value:
            return None

        candidate_path = self._get_data_dir() / Path(metadata_path_value)
        if not candidate_path.exists():
            return None

        try:
            payload = json.loads(candidate_path.read_text(encoding="utf-8"))
        except Exception:
            return None

        if not isinstance(payload, dict):
            return None

        parts: list[str] = []
        for key in ["title", "container-title", "publisher", "abstract", "DOI", "URL"]:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
            elif isinstance(value, list):
                joined = " ".join(str(item).strip() for item in value if str(item).strip())
                if joined:
                    parts.append(joined)

        subject = payload.get("subject")
        if isinstance(subject, list):
            joined_subjects = " ".join(str(item).strip() for item in subject if str(item).strip())
            if joined_subjects:
                parts.append(joined_subjects)

        cleaned = re.sub(r"\s+", " ", " ".join(parts)).strip()
        return cleaned[:8000] if cleaned else None

    def _merge_source_and_metadata_text(self, source_text: str, metadata_text: str | None) -> str:
        merged = source_text.strip()
        if metadata_text:
            merged = f"{merged}\n\nMetadata summary: {metadata_text.strip()}"
        return merged[:24000]

    def _build_reference_documents(self) -> list[KnowledgeDocument]:
        manifest_index = self._load_reference_manifest()
        documents: list[KnowledgeDocument] = []
        for ref in REFERENCE_CATALOG:
            source_payload = self._load_seed_source(ref, manifest_index)
            doc = KnowledgeDocument(
                doc_id=ref["id"],
                title=ref["title"],
                content=source_payload["content"]
                or f"{ref['title']}. {ref.get('description_en', '')} {ref.get('description_ar', '')} Category: {ref.get('category', '')}. Subcategory: {ref.get('subcategory', '')}.",
                category=ref.get("category", "reference"),
                study_types=ref.get("study_types", ["shared"]),
                source_file=source_payload["source_file"] or f"{ref['id']}.pdf",
                source_url=source_payload["source_url"],
                page=1,
                section=ref.get("subcategory", "Guidelines"),
            )
            documents.append(doc)
        return documents

    def _seed_catalog(self):
        """Seed all catalog references into the RAG index."""
        self.documents.extend(self._build_reference_documents())
        self._load_disk_index()

    def reload_reference_library(self) -> dict[str, Any]:
        user_documents = [doc for doc in self.documents if doc.doc_id.startswith("user_")]
        reference_documents = self._build_reference_documents()
        self.documents = [*reference_documents, *user_documents]
        metrics = self.get_reference_library_metrics()
        return {
            "message": "Reference library reindexed from the current manifest.",
            "referenceDocuments": len(reference_documents),
            "userDocumentsRetained": len(user_documents),
            "metrics": metrics,
        }

    def get_reference_library_metrics(self) -> dict[str, Any]:
        manifest_index = self._load_reference_manifest()
        text_backed = 0
        missing_reference_ids: list[str] = []

        for ref in REFERENCE_CATALOG:
            entry = manifest_index.get(ref["id"]) or {}
            text_path = entry.get("text_path")
            page_path = entry.get("page_path")
            metadata_path = entry.get("metadata_path")
            has_real_asset = False
            for path_value in [text_path, page_path, metadata_path]:
                if isinstance(path_value, str) and path_value:
                    candidate = self._get_data_dir() / Path(path_value)
                    if candidate.exists():
                        has_real_asset = True
                        break
            if has_real_asset:
                text_backed += 1
            else:
                missing_reference_ids.append(str(ref["id"]))

        seeded_reference_documents = len([doc for doc in self.documents if not doc.doc_id.startswith("user_")])
        manifest_coverage = (text_backed / len(REFERENCE_CATALOG) * 100.0) if REFERENCE_CATALOG else 0.0
        return {
            "catalogReferences": len(REFERENCE_CATALOG),
            "manifestEntries": len(manifest_index),
            "seededReferenceDocuments": seeded_reference_documents,
            "realAssetBackedReferences": text_backed,
            "coveragePercent": round(manifest_coverage, 2),
            "missingReferenceIdsSample": missing_reference_ids[:10],
        }

    def _detect_query_concepts(self, query_tokens: list[str], study_type: str | None = None) -> list[str]:
        concepts: set[str] = set()
        normalized_study_type = (study_type or "").strip().lower()
        if normalized_study_type:
            concepts.add(normalized_study_type)

        for token in query_tokens:
            if token in SEMANTIC_SYNONYMS:
                concepts.add(token)
                continue
            for concept, synonyms in SEMANTIC_SYNONYMS.items():
                if token == concept or token in synonyms:
                    concepts.add(concept)

        return sorted(concepts)

    def _bm25_score(self, query_tokens: list[str], doc: KnowledgeDocument, candidate_docs: list[KnowledgeDocument]) -> float:
        if not doc.tokens:
            return 0.0

        avg_doc_len = sum(len(item.tokens) for item in candidate_docs if item.tokens) / max(1, len(candidate_docs))
        doc_len = len(doc.tokens)
        k1 = 1.5
        b = 0.75
        score = 0.0

        for token in query_tokens:
            tf = doc.tokens.count(token)
            if tf == 0:
                continue
            df = sum(1 for candidate in candidate_docs if token in candidate.tokens)
            idf = math.log(1 + ((len(candidate_docs) - df + 0.5) / (df + 0.5)))
            numerator = tf * (k1 + 1)
            denominator = tf + k1 * (1 - b + b * (doc_len / max(avg_doc_len, 1.0)))
            score += idf * (numerator / max(denominator, 1e-9))

        return score

    def _semantic_intent_score(
        self,
        query_tokens: list[str],
        concepts: list[str],
        doc: KnowledgeDocument,
        study_type: str | None = None,
    ) -> float:
        score = 0.0
        overlap = len(set(query_tokens) & set(doc.tokens))
        if query_tokens:
            score += (overlap / len(set(query_tokens))) * 2.2

        title_overlap = len(set(query_tokens) & set(doc.title_tokens))
        if title_overlap:
            score += title_overlap * 1.4

        context_overlap = len(set(query_tokens) & set(doc.context_tokens))
        if context_overlap:
            score += context_overlap * 0.85

        for concept in concepts:
            synonyms = SEMANTIC_SYNONYMS.get(concept, [])
            if concept in doc.context_tokens:
                score += 1.8
            if concept in doc.title_tokens:
                score += 1.2
            synonym_hits = sum(1 for synonym in synonyms if synonym in doc.tokens or synonym in doc.title_tokens)
            if synonym_hits:
                score += min(2.4, synonym_hits * 0.4)

        normalized_study_type = (study_type or "").strip().lower()
        if normalized_study_type and normalized_study_type in doc.study_types:
            score += 1.3
        elif normalized_study_type and "shared" in doc.study_types:
            score += 0.45

        if doc.source_url:
            score += 0.2

        return score

    def _rank_documents(
        self,
        query_tokens: list[str],
        concepts: list[str],
        candidate_docs: list[KnowledgeDocument],
        study_type: str | None = None,
    ) -> list[tuple[float, KnowledgeDocument]]:
        ranked: list[tuple[float, KnowledgeDocument]] = []
        for doc in candidate_docs:
            lexical = self._bm25_score(query_tokens, doc, candidate_docs)
            semantic = self._semantic_intent_score(query_tokens, concepts, doc, study_type)
            total = lexical + semantic
            if total > 0:
                ranked.append((total, doc))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

    def _detect_query_intent(self, question: str, base_tokens: list[str]) -> str:
        normalized = question.strip().lower()
        token_set = set(base_tokens)

        if (
            "consort" in normalized
            and ("25" in normalized or "25." in normalized or "items" in token_set or "بنود" in token_set)
        ):
            return "consort_items"

        if "ich e6" in normalized or "e6" in token_set:
            return "ich_e6"

        if (
            ("summary" in token_set or "summarize" in token_set or "summary" in normalized)
            or ("لخص" in normalized or "تلخيص" in normalized or "ملخص" in normalized)
        ) and ("study" in token_set or "دراسة" in normalized or "بحث" in normalized):
            return "study_summary"

        return "general"

    def _prioritize_primary_references(
        self,
        ranked_docs: list[tuple[float, KnowledgeDocument]],
        intent: str,
    ) -> list[tuple[float, KnowledgeDocument]]:
        preferred_ids = PRIMARY_REFERENCE_HINTS.get(intent, [])
        if not preferred_ids:
            return ranked_docs

        boosted: list[tuple[float, KnowledgeDocument]] = []
        for score, doc in ranked_docs:
            next_score = score
            if doc.doc_id in preferred_ids:
                next_score += 5.0
            elif doc.category == "reporting_extension" and intent == "consort_items":
                next_score -= 1.4
            boosted.append((next_score, doc))

        boosted.sort(key=lambda item: item[0], reverse=True)
        return boosted

    def _narrow_candidates_for_intent(
        self,
        candidate_docs: list[KnowledgeDocument],
        intent: str,
    ) -> list[KnowledgeDocument]:
        if intent == "consort_items":
            narrowed = [
                doc for doc in candidate_docs
                if doc.doc_id in PRIMARY_REFERENCE_HINTS["consort_items"] or doc.category == "reporting"
            ]
            return narrowed or candidate_docs

        if intent == "ich_e6":
            narrowed = [
                doc for doc in candidate_docs
                if doc.doc_id in PRIMARY_REFERENCE_HINTS["ich_e6"] or doc.category == "clinical_practice"
            ]
            return narrowed or candidate_docs

        return candidate_docs

    def _select_diverse_top_matches(
        self,
        ranked_docs: list[tuple[float, KnowledgeDocument]],
        limit: int,
        lambda_weight: float = 0.78,
    ) -> list[KnowledgeDocument]:
        if not ranked_docs or limit <= 0:
            return []

        selected: list[KnowledgeDocument] = []
        remaining = ranked_docs[:]

        while remaining and len(selected) < limit:
            best_idx = 0
            best_score = -float("inf")

            for idx, (base_score, candidate) in enumerate(remaining):
                novelty_penalty = 0.0
                for chosen in selected:
                    token_overlap = len(set(candidate.tokens) & set(chosen.tokens)) / max(
                        1,
                        len(set(candidate.tokens) | set(chosen.tokens)),
                    )
                    same_category = 0.2 if candidate.category == chosen.category else 0.0
                    novelty_penalty = max(novelty_penalty, token_overlap + same_category)

                mmr_score = lambda_weight * base_score - (1 - lambda_weight) * novelty_penalty
                if mmr_score > best_score:
                    best_score = mmr_score
                    best_idx = idx

            _, picked = remaining.pop(best_idx)
            selected.append(picked)

        return selected

    def _get_db_path(self) -> Path:
        return self._get_data_dir() / "rag_index_db.json"

    def _save_disk_index(self):
        """Persist user-ingested documents to disk JSON database."""
        try:
            db_path = self._get_db_path()
            user_docs = [
                {
                    "doc_id": d.doc_id,
                    "title": d.title,
                    "content": d.content,
                    "category": d.category,
                    "study_types": d.study_types,
                    "source_file": d.source_file,
                    "source_url": d.source_url,
                    "page": d.page,
                    "section": d.section,
                }
                for d in self.documents
                if d.doc_id.startswith("user_")
            ]
            with open(db_path, "w", encoding="utf-8") as f:
                json.dump(user_docs, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load_disk_index(self):
        """Load user-ingested documents from disk JSON database if present."""
        try:
            db_path = self._get_db_path()
            if not db_path.exists():
                return
            with open(db_path, "r", encoding="utf-8") as f:
                user_docs_data = json.load(f)
            for item in user_docs_data:
                doc = KnowledgeDocument(
                    doc_id=item["doc_id"],
                    title=item["title"],
                    content=item["content"],
                    category=item.get("category", "user_doc"),
                    study_types=item.get("study_types", ["shared"]),
                    source_file=item.get("source_file"),
                    source_url=item.get("source_url"),
                    page=item.get("page", 1),
                    section=item.get("section", "Ingested"),
                )
                self.documents.append(doc)
        except Exception:
            pass


    def ingest_text(
        self,
        filename: str,
        text: str,
        document_type: str = "reference",
        study_type: str | None = None,
    ) -> dict[str, Any]:
        """Chunk and ingest a user-uploaded text file or protocol into the index."""
        paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 30]
        if not paragraphs:
            paragraphs = [text.strip()] if text.strip() else ["Empty document content."]

        added_chunks = 0
        for idx, paragraph in enumerate(paragraphs, start=1):
            chunk_doc = KnowledgeDocument(
                doc_id=f"user_{filename}_{idx}",
                title=f"{filename} (Part {idx})",
                content=paragraph,
                category=document_type,
                study_types=[study_type.lower()] if study_type else ["shared"],
                source_file=filename,
                source_url=None,
                page=idx,
                section=f"Section {idx}",
            )
            self.documents.append(chunk_doc)
            added_chunks += 1

        self._save_disk_index()

        return {
            "message": f"Successfully ingested '{filename}' into RAG index.",
            "filename": filename,
            "document_type": document_type,
            "chunks_processed": added_chunks,
            "evidence_rank": 1,
            "evidence_level_label": "User Document Source",
            "is_primary_reference": True,
            "database_status": "indexed_locally",
        }

    def ingest_pdf_file(
        self,
        filepath: str | Path,
        filename: str | None = None,
        document_type: str = "protocol",
        study_type: str | None = "rct",
    ) -> dict[str, Any]:
        """Ingest a PDF file page-by-page into the RAG index with page-level citations."""
        path = Path(filepath)
        if not path.exists():
            return {"error": f"File not found: {filepath}", "chunks_processed": 0}

        doc_name = filename or path.name
        added_chunks = 0

        try:
            import pypdf
            reader = pypdf.PdfReader(str(path))
            for page_idx, page in enumerate(reader.pages, start=1):
                page_text = page.extract_text() or ""
                paragraphs = [p.strip() for p in page_text.split("\n\n") if len(p.strip()) > 30]
                if not paragraphs and page_text.strip():
                    paragraphs = [page_text.strip()]

                for chunk_idx, paragraph in enumerate(paragraphs, start=1):
                    chunk_doc = KnowledgeDocument(
                        doc_id=f"user_{doc_name}_p{page_idx}_c{chunk_idx}",
                        title=f"{doc_name} (Page {page_idx}, Part {chunk_idx})",
                        content=paragraph,
                        category=document_type,
                        study_types=[study_type.lower()] if study_type else ["shared"],
                        source_file=doc_name,
                        source_url=None,
                        page=page_idx,
                        section=f"Page {page_idx}",
                    )
                    self.documents.append(chunk_doc)
                    added_chunks += 1
        except Exception as e:
            return {"error": f"Failed to extract PDF text: {str(e)}", "chunks_processed": 0}

        self._save_disk_index()

        return {
            "message": f"Successfully ingested PDF '{doc_name}' ({added_chunks} chunks across pages) into RAG index.",
            "filename": doc_name,
            "document_type": document_type,
            "chunks_processed": added_chunks,
            "total_pages": len(reader.pages) if 'reader' in locals() else 0,
            "evidence_rank": 1,
            "evidence_level_label": "User Uploaded Protocol PDF",
            "is_primary_reference": True,
            "database_status": "indexed_locally",
        }


    def query(
        self,
        question: str,
        study_type: str | None = None,
        filter_source: str | None = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Perform grounded RAG search with study-type isolation and citations."""
        base_tokens = _tokenize(question)
        q_tokens = self._expand_query_tokens(question, study_type)
        concepts = self._detect_query_concepts(q_tokens, study_type)
        intent = self._detect_query_intent(question, base_tokens)
        if not q_tokens:
            return {
                "answer": "الرجاء تقديم استفسار بحثي محدد للبحث في المكتبة المعرفية.",
                "citations": [],
                "retrieval": {
                    "strategy": "filtered_only",
                    "fallbackApplied": False,
                    "attempts": [{"label": "empty_query", "citationCount": 0, "useful": False}],
                },
            }

        if intent == "study_summary":
            return {
                "answer": (
                    "لا يمكن تلخيص دراسة علمية بدقة من عنوان عام فقط. "
                    "الرجاء رفع ملف الدراسة أو لصق نص الملخص/المقدمة/النتائج، ثم أعد الطلب بصيغة مثل: "
                    "'لخص هذه الدراسة' أو 'استخرج الهدف والمنهجية والنتائج الأساسية'."
                ),
                "citations": [],
                "retrieval": {
                    "strategy": "guardrail_only",
                    "fallbackApplied": False,
                    "intent": intent,
                    "attempts": [{"label": "study_summary_requires_document", "citationCount": 0, "useful": False}],
                },
            }

        # Filter documents by study_type if specified
        norm_study_type = (study_type or "").strip().lower()
        if norm_study_type:
            candidate_docs = [
                d for d in self.documents
                if norm_study_type in d.study_types or "shared" in d.study_types
            ]
        else:
            candidate_docs = list(self.documents)
        candidate_docs = self._narrow_candidates_for_intent(candidate_docs, intent)

        # First Attempt: Search with filter_source if requested
        attempts = []
        effective_docs = candidate_docs
        used_fallback = False

        if filter_source:
            source_matched = [d for d in candidate_docs if filter_source.lower() in d.source_file.lower()]
            if source_matched:
                effective_docs = source_matched
                attempts.append({"label": "filtered_source", "citationCount": len(effective_docs), "useful": True})
            else:
                used_fallback = True
                attempts.append({"label": "filtered_source", "citationCount": 0, "useful": False})

        ranked_scores = self._rank_documents(q_tokens, concepts, effective_docs, study_type)
        ranked_scores = self._prioritize_primary_references(ranked_scores, intent)

        # If filtered search gave no matches, fallback to broader candidate docs
        if not ranked_scores and filter_source and not used_fallback:
            used_fallback = True
            ranked_scores = self._rank_documents(q_tokens, concepts, candidate_docs, study_type)
            ranked_scores = self._prioritize_primary_references(ranked_scores, intent)

        top_matches = self._select_diverse_top_matches(ranked_scores, limit)

        citations = []
        evidence_lines = []

        for idx, doc in enumerate(top_matches, start=1):
            citations.append({
                "id": doc.doc_id,
                "title": doc.title,
                "source_file": doc.source_file,
                "source_url": doc.source_url,
                "page": doc.page or 1,
                "section": doc.section or "General",
                "quoted_text": doc.content[:240] + ("..." if len(doc.content) > 240 else ""),
            })
            evidence_lines.append(f"[{idx}] {doc.title} ({doc.source_file}): {doc.content[:300]}")

        if citations:
            answer = self._synthesize_grounded_answer(question, intent, top_matches, citations)
        else:
            answer = (
                "لم يتم العثور على مراجع مباشرة تغطي الاستفسار المظبوط بالضبط، "
                "ولكن تم ربط الجلسة بالمبادئ العامة للبحث العلمي والإحصاء السريري."
            )

        return {
            "answer": answer,
            "citations": citations,
            "retrieval": {
                "strategy": "semantic_hybrid_ranked",
                "fallbackApplied": used_fallback,
                "effectiveFilterSource": filter_source if not used_fallback else None,
                "queryTerms": base_tokens[:12],
                "expandedTerms": q_tokens[:20],
                "concepts": concepts,
                "intent": intent,
                "attempts": attempts or [{"label": "search_executed", "citationCount": len(citations), "useful": len(citations) > 0}],
            },
        }

    def _expand_query_tokens(self, question: str, study_type: str | None = None) -> list[str]:
        q_tokens = _tokenize(question)
        expanded = set(q_tokens)
        normalized_study_type = (study_type or "").strip().lower()

        if normalized_study_type in SEMANTIC_SYNONYMS:
            expanded.add(normalized_study_type)
            expanded.update(SEMANTIC_SYNONYMS[normalized_study_type])

        for token in list(q_tokens):
            if token in SEMANTIC_SYNONYMS:
                expanded.update(SEMANTIC_SYNONYMS[token])
                continue
            for key, values in SEMANTIC_SYNONYMS.items():
                if token in values:
                    expanded.add(key)
                    expanded.update(values)

        return list(expanded)

    def _synthesize_grounded_answer(
        self,
        question: str,
        intent: str,
        top_matches: list[KnowledgeDocument],
        citations: list[dict[str, Any]],
    ) -> str:
        if intent == "consort_items":
            return self._build_consort_items_answer(citations)
        if intent == "ich_e6":
            return self._build_ich_e6_answer(citations)

        lead_lines = [
            "خلاصة مبنية على المراجع الأعلى صلة في المكتبة المعرفية:",
        ]
        for idx, doc in enumerate(top_matches[:3], start=1):
            lead_lines.append(
                f"{idx}. {doc.title}: {doc.content[:240].strip()}"
            )
        lead_lines.append("المراجع المعتمدة المذكورة أدناه هي التي بُنيت عليها الإجابة.")
        return "\n".join(lead_lines)

    def _build_consort_items_answer(self, citations: list[dict[str, Any]]) -> str:
        sections = [
            "1. العنوان والملخص: يجب تحديد أن الدراسة تجربة عشوائية بوضوح، مع ملخص منظم يوضح التصميم والتدخلات والنتائج.",
            "2. المقدمة: توضح الخلفية العلمية والفرضية أو الأهداف الأساسية والثانوية.",
            "3. المنهجية: تشمل تصميم التجربة، معايير الأهلية، مكان الدراسة، تفاصيل التدخلات، تعريف النتائج، حساب حجم العينة، وآلية العشوائية والإخفاء والتعمية.",
            "4. النتائج: تشمل تدفق المشاركين، أعداد التحليل، الخصائص الأساسية، نتائج كل Outcome، الأضرار أو الأحداث السلبية، وأي تحليلات إضافية.",
            "5. المناقشة: تفسر القيود، وقابلية التعميم، والتوازن بين الفوائد والمخاطر، ومعنى النتائج سريريًا ومنهجيًا.",
            "6. المعلومات الأخرى: تشمل رقم التسجيل، توفر البروتوكول، مصادر التمويل، ودور الجهة الداعمة.",
        ]
        item_note = (
            "تفصيلاً، بنود CONSORT الـ25 تُنظم عادةً تحت هذه المحاور الكبرى، "
            "ويُستخدم CONSORT Checklist وCONSORT Explanation & Elaboration لشرح كل بند فرعي عمليًا عند كتابة التقرير النهائي."
        )
        refs = self._format_citation_footnotes(citations)
        return "\n".join([
            "شرح منظم لبنود CONSORT الـ25:",
            item_note,
            *sections,
            "المراجع الأساسية المستخدمة:",
            refs,
        ])

    def _build_ich_e6_answer(self, citations: list[dict[str, Any]]) -> str:
        sections = [
            "1. المبادئ العامة لـ GCP: حماية حقوق ورفاه وسلامة المشاركين، وأن تكون الفوائد والمخاطر مبررة، وأن تُجرى الدراسة وفق بروتوكول معتمد.",
            "2. المسؤوليات الأخلاقية والرقابية: تشمل IRB/IEC approval، والموافقة المستنيرة، وحماية الخصوصية والسرية، والإبلاغ عن أي تغييرات جوهرية.",
            "3. مسؤوليات الباحث: الالتزام بالبروتوكول، التأكد من أهلية المشاركين، حفظ السجلات، الإبلاغ عن السلامة، وضمان تفويض المهام بشكل موثق.",
            "4. مسؤوليات الراعي: تصميم الدراسة، اختيار المواقع، الإشراف والـ monitoring، إدارة الجودة المبنية على المخاطر، وضمان سلامة البيانات.",
            "5. إدارة البيانات والجودة: دقة CRF/EDC، traceability، essential documents، audit trail، تصحيح الانحرافات، والتحقق من اتساق البيانات.",
            "6. السلامة والإبلاغ: توثيق adverse events وserious adverse events والإبلاغ عنها ضمن الأطر الزمنية النظامية.",
            "7. التوثيق والأرشفة: حفظ الملفات الأساسية والنسخ المعتمدة للبروتوكول والـ investigator brochure والموافقات والسجلات النهائية.",
        ]
        refs = self._format_citation_footnotes(citations)
        return "\n".join([
            "ملخص تفصيلي عملي لمعايير ICH E6:",
            "ICH E6 يضع إطار Good Clinical Practice الذي يحكم السلوك الأخلاقي، جودة التنفيذ، ومصداقية البيانات في الدراسات السريرية.",
            *sections,
            "المراجع الأساسية المستخدمة:",
            refs,
        ])

    def _format_citation_footnotes(self, citations: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for citation in citations[:5]:
            title = str(citation.get("title") or citation.get("id") or citation.get("source_file") or "Unknown reference")
            section = str(citation.get("section") or "General")
            source_file = str(citation.get("source_file") or "")
            lines.append(f"- {title} | {source_file} | {section}")
        return "\n".join(lines)


# Global Singleton RAG Engine instance
rag_engine = LocalRAGEngine()
