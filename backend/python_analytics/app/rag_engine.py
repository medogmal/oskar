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
import hashlib
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

VECTOR_DIMENSIONS = 256
EMBEDDING_MODEL_NAME = "local_hashing_embedding_v1"


def _tokenize(text: str) -> list[str]:
    """Tokenize English and Arabic text into lowercase words/terms (min length 2)."""
    return [
        w.lower()
        for w in re.split(r"[^\w]+", text, flags=re.UNICODE)
        if len(w) >= 2
    ]


def _hash_embedding(tokens: list[str], dimensions: int = VECTOR_DIMENSIONS) -> list[float]:
    vector = [0.0] * dimensions
    for token in tokens:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[bucket] += sign

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


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
        self.embedding = _hash_embedding(self.tokens + self.title_tokens + self.context_tokens)


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
        manifest_present = self._get_reference_manifest_path().exists()
        text_backed = 0
        html_backed = 0
        metadata_backed = 0
        asset_backed = 0
        missing_reference_ids: list[str] = []

        for ref in REFERENCE_CATALOG:
            entry = manifest_index.get(ref["id"]) or {}
            text_path = entry.get("text_path")
            page_path = entry.get("page_path")
            metadata_path = entry.get("metadata_path")
            has_text = isinstance(text_path, str) and bool(text_path) and (self._get_data_dir() / Path(text_path)).exists()
            has_html = isinstance(page_path, str) and bool(page_path) and (self._get_data_dir() / Path(page_path)).exists()
            has_metadata = isinstance(metadata_path, str) and bool(metadata_path) and (self._get_data_dir() / Path(metadata_path)).exists()

            if has_text:
                text_backed += 1
            if has_html:
                html_backed += 1
            if has_metadata:
                metadata_backed += 1
            if has_text or has_html or has_metadata:
                asset_backed += 1
            else:
                missing_reference_ids.append(str(ref["id"]))

        seeded_reference_documents = len([doc for doc in self.documents if not doc.doc_id.startswith("user_")])
        manifest_coverage = (text_backed / len(REFERENCE_CATALOG) * 100.0) if REFERENCE_CATALOG else 0.0
        return {
            "retrievalEngine": "local_hybrid_bm25_tfidf_synonym_vector_ranker",
            "embeddingModel": EMBEDDING_MODEL_NAME,
            "vectorDimensions": VECTOR_DIMENSIONS,
            "semanticSimilarity": "domain_synonyms_plus_local_vector_cosine",
            "vectorDatabaseConfigured": True,
            "manifestPresent": manifest_present,
            "catalogReferences": len(REFERENCE_CATALOG),
            "manifestEntries": len(manifest_index),
            "seededReferenceDocuments": seeded_reference_documents,
            "textBackedReferences": text_backed,
            "htmlBackedReferences": html_backed,
            "metadataBackedReferences": metadata_backed,
            "realAssetBackedReferences": asset_backed,
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
        query_embedding = _hash_embedding(query_tokens + concepts)
        for doc in candidate_docs:
            lexical = self._bm25_score(query_tokens, doc, candidate_docs)
            semantic = self._semantic_intent_score(query_tokens, concepts, doc, study_type)
            vector = _cosine_similarity(query_embedding, doc.embedding)
            total = lexical + semantic + (max(0.0, vector) * 2.0)
            if total > 0:
                ranked.append((total, doc))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

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

        # Filter documents by study_type if specified
        norm_study_type = (study_type or "").strip().lower()
        if norm_study_type:
            candidate_docs = [
                d for d in self.documents
                if norm_study_type in d.study_types or "shared" in d.study_types
            ]
        else:
            candidate_docs = list(self.documents)

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

        # If filtered search gave no matches, fallback to broader candidate docs
        if not ranked_scores and filter_source and not used_fallback:
            used_fallback = True
            ranked_scores = self._rank_documents(q_tokens, concepts, candidate_docs, study_type)

        top_matches = self._select_diverse_top_matches(ranked_scores, limit)

        citations = []
        evidence_lines = []

        for idx, doc in enumerate(top_matches, start=1):
            is_user_source = doc.doc_id.startswith("user_")
            source_backed = is_user_source or bool(doc.source_url)
            if doc.source_file and not doc.source_file.endswith(".pdf"):
                source_backed = True
            citations.append({
                "doc_id": doc.doc_id,
                "title": doc.title,
                "source_file": doc.source_file,
                "source_url": doc.source_url,
                "study_types": doc.study_types,
                "category": doc.category,
                "source_backed": source_backed,
                "page": doc.page or 1,
                "section": doc.section or "General",
                "quoted_text": doc.content[:240] + ("..." if len(doc.content) > 240 else ""),
            })
            evidence_lines.append(f"[{idx}] {doc.title} ({doc.source_file}): {doc.content[:300]}")

        if citations:
            answer = (
                f"بناءً على مراجع المكتبة المعرفية المعتمدة لهذا المنهج:\n\n"
                + "\n\n".join(evidence_lines[:3])
            )
        else:
            answer = (
                "لم يتم العثور على مراجع مباشرة تغطي الاستفسار المظبوط بالضبط، "
                "ولكن تم ربط الجلسة بالمبادئ العامة للبحث العلمي والإحصاء السريري."
            )

        return {
            "answer": answer,
            "citations": citations,
            "retrieval": {
                "strategy": "semantic_hybrid_vector_ranked",
                "embeddingModel": EMBEDDING_MODEL_NAME,
                "vectorDimensions": VECTOR_DIMENSIONS,
                "fallbackApplied": used_fallback,
                "effectiveFilterSource": filter_source if not used_fallback else None,
                "queryTerms": base_tokens[:12],
                "expandedTerms": q_tokens[:20],
                "concepts": concepts,
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


# Global Singleton RAG Engine instance
rag_engine = LocalRAGEngine()
