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
        page: int | None = None,
        section: str | None = None,
    ):
        self.doc_id = doc_id
        self.title = title
        self.content = content
        self.category = category
        self.study_types = study_types or ["shared"]
        self.source_file = source_file or f"{doc_id}.pdf"
        self.page = page
        self.section = section
        self.tokens = _tokenize(f"{title} {content} {category}")


class LocalRAGEngine:
    """Lightweight in-memory RAG engine with TF-IDF/BM25 scoring and study-type isolation."""

    def __init__(self):
        self.documents: list[KnowledgeDocument] = []
        self._seed_catalog()

    def _seed_catalog(self):
        """Seed all 130 catalog references into the RAG index."""
        for ref in REFERENCE_CATALOG:
            doc = KnowledgeDocument(
                doc_id=ref["id"],
                title=ref["title"],
                content=f"{ref['title']}. {ref.get('description_en', '')} {ref.get('description_ar', '')} Category: {ref.get('category', '')}. Subcategory: {ref.get('subcategory', '')}.",
                category=ref.get("category", "reference"),
                study_types=ref.get("study_types", ["shared"]),
                source_file=f"{ref['id']}.pdf",
                page=1,
                section=ref.get("subcategory", "Guidelines"),
            )
            self.documents.append(doc)
        self._load_disk_index()

    def _get_db_path(self) -> Path:
        data_dir = Path(__file__).parent.parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "rag_index_db.json"

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

    def query(
        self,
        question: str,
        study_type: str | None = None,
        filter_source: str | None = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Perform grounded RAG search with study-type isolation and citations."""
        q_tokens = _tokenize(question)
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

        # Calculate scores using simple TF-IDF / term overlap match
        doc_count = max(1, len(candidate_docs))
        scores: list[tuple[float, KnowledgeDocument]] = []

        for doc in effective_docs:
            if not doc.tokens:
                continue
            score = 0.0
            for qt in q_tokens:
                tf = doc.tokens.count(qt) / len(doc.tokens)
                if tf > 0:
                    df = sum(1 for d in candidate_docs if qt in d.tokens)
                    idf = math.log((doc_count + 1) / (df + 1)) + 1.0
                    score += tf * idf
            if score > 0:
                scores.append((score, doc))

        # If filtered search gave no matches, fallback to broader candidate docs
        if not scores and filter_source and not used_fallback:
            used_fallback = True
            for doc in candidate_docs:
                if not doc.tokens:
                    continue
                score = 0.0
                for qt in q_tokens:
                    tf = doc.tokens.count(qt) / len(doc.tokens)
                    if tf > 0:
                        df = sum(1 for d in candidate_docs if qt in d.tokens)
                        idf = math.log((doc_count + 1) / (df + 1)) + 1.0
                        score += tf * idf
                if score > 0:
                    scores.append((score, doc))

        scores.sort(key=lambda x: x[0], reverse=True)
        top_matches = [doc for _sc, doc in scores[:limit]]

        citations = []
        evidence_lines = []

        for idx, doc in enumerate(top_matches, start=1):
            citations.append({
                "source_file": doc.source_file,
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
                "strategy": "filtered_then_broadened" if used_fallback else ("filtered_only" if filter_source else "broadened_only"),
                "fallbackApplied": used_fallback,
                "effectiveFilterSource": filter_source if not used_fallback else None,
                "attempts": attempts or [{"label": "search_executed", "citationCount": len(citations), "useful": len(citations) > 0}],
            },
        }


# Global Singleton RAG Engine instance
rag_engine = LocalRAGEngine()
