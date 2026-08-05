"""
ClinResearch AI - Clinical vector-backed RAG engine
===================================================
Provides grounded retrieval, document chunking, Chroma vector indexing, hybrid
BM25 + clinical embedding ranking, study-type isolation, and citation metadata.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from pathlib import Path
from typing import Any

from .knowledge_catalog import REFERENCE_CATALOG

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

VECTOR_DIMENSIONS = 256
LOCAL_FALLBACK_EMBEDDING_MODEL = "local_hashing_embedding_v1"
DEFAULT_CLINICAL_EMBEDDING_MODEL = "pritamdeka/S-PubMedBert-MS-MARCO"
DEFAULT_VECTOR_BACKEND = "chroma"
VECTOR_COLLECTION_NAME = "clinresearch_reference_library"


def _tokenize(text: str) -> list[str]:
    """Tokenize English and Arabic text into lowercase words/terms."""
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

    return _normalize_embedding(vector)


def _normalize_embedding(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_collection_suffix(value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]
    return digest


class ClinicalEmbeddingProvider:
    """Lazy clinical embedding provider with a deterministic local fallback."""

    def __init__(self) -> None:
        self.provider = (os.getenv("RAG_EMBEDDING_PROVIDER") or "sentence_transformers").strip().lower()
        self.configured_model_name = (os.getenv("CLINICAL_EMBEDDING_MODEL") or DEFAULT_CLINICAL_EMBEDDING_MODEL).strip()
        self.batch_size = max(1, int(os.getenv("RAG_EMBEDDING_BATCH_SIZE") or "16"))
        self._model: Any = None
        self._attempted_load = False
        self._ready = False
        self._fallback_reason: str | None = None
        self._dimensions = VECTOR_DIMENSIONS

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def fallback_applied(self) -> bool:
        return not self._ready

    @property
    def fallback_reason(self) -> str | None:
        return self._fallback_reason

    @property
    def active_model_name(self) -> str:
        return self.configured_model_name if self._ready else LOCAL_FALLBACK_EMBEDDING_MODEL

    @property
    def provider_name(self) -> str:
        return "sentence-transformers" if self._ready else "local-hashing-fallback"

    def _load_model(self) -> None:
        if self._attempted_load:
            return
        self._attempted_load = True

        if self.provider in {"hash", "local", "local_hashing"}:
            self._fallback_reason = "Clinical embedding provider disabled by RAG_EMBEDDING_PROVIDER."
            return

        try:
            from sentence_transformers import SentenceTransformer
        except Exception as error:
            self._fallback_reason = f"sentence-transformers is unavailable: {error}"
            return

        try:
            kwargs: dict[str, Any] = {}
            device = os.getenv("CLINICAL_EMBEDDING_DEVICE")
            if device:
                kwargs["device"] = device
            if _truthy_env(os.getenv("CLINICAL_EMBEDDING_TRUST_REMOTE_CODE")):
                kwargs["trust_remote_code"] = True
            self._model = SentenceTransformer(self.configured_model_name, **kwargs)
            self._ready = True
        except Exception as error:
            self._model = None
            self._ready = False
            self._fallback_reason = f"Clinical embedding model could not be loaded: {error}"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        self._load_model()
        if self._model is not None:
            try:
                embeddings = self._model.encode(
                    texts,
                    batch_size=self.batch_size,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
                result = [[float(value) for value in vector] for vector in embeddings.tolist()]
                if result:
                    self._dimensions = len(result[0])
                return result
            except Exception as error:
                self._model = None
                self._ready = False
                self._fallback_reason = f"Clinical embedding encode failed: {error}"

        return [_hash_embedding(_tokenize(text), VECTOR_DIMENSIONS) for text in texts]


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

    def embedding_text(self) -> str:
        return "\n".join(
            [
                f"Title: {self.title}",
                f"Category: {self.category}",
                f"Study types: {', '.join(self.study_types)}",
                f"Section: {self.section or 'General'}",
                self.content,
            ]
        )

    def vector_metadata(self) -> dict[str, str | int | bool]:
        return {
            "doc_id": self.doc_id,
            "title": self.title[:500],
            "category": self.category,
            "study_types": ",".join(self.study_types),
            "source_file": self.source_file or "",
            "source_url": self.source_url or "",
            "page": int(self.page or 1),
            "section": self.section or "General",
            "is_user_source": self.doc_id.startswith("user_"),
        }


class ChromaVectorStore:
    def __init__(self, data_dir: Path, collection_name: str) -> None:
        self.backend = "chroma"
        self.is_external_vector_database = True
        self.ready = False
        self.error: str | None = None
        self._collection_name = collection_name
        self._client: Any = None
        self._collection: Any = None

        try:
            import chromadb

            store_path = data_dir / "chroma_rag"
            store_path.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(store_path))
            self._collection = self._client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "cosine"},
            )
            self.ready = True
        except Exception as error:
            self.error = str(error)

    def _reset_collection(self) -> None:
        if self._client is None:
            return
        try:
            self._client.delete_collection(self._collection_name)
        except Exception:
            pass
        self._collection = self._client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def upsert(self, documents: list[KnowledgeDocument], embeddings: list[list[float]]) -> None:
        if not self.ready or self._collection is None or not documents:
            return

        ids = [doc.doc_id for doc in documents]
        metadatas = [doc.vector_metadata() for doc in documents]
        payload_documents = [doc.content[:12000] for doc in documents]

        try:
            self._collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=payload_documents,
                metadatas=metadatas,
            )
        except Exception as error:
            if "dimension" not in str(error).lower():
                raise
            self._reset_collection()
            self._collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=payload_documents,
                metadatas=metadatas,
            )

    def query(self, query_embedding: list[float], limit: int) -> dict[str, float]:
        if not self.ready or self._collection is None or not query_embedding:
            return {}

        try:
            count = max(1, int(self._collection.count()))
            result = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=min(max(1, limit), count),
                include=["distances"],
            )
        except Exception as error:
            self.error = str(error)
            return {}

        ids = result.get("ids", [[]])
        distances = result.get("distances", [[]])
        if not ids or not ids[0]:
            return {}

        scores: dict[str, float] = {}
        for doc_id, distance in zip(ids[0], distances[0] if distances else []):
            try:
                score = max(0.0, 1.0 - float(distance))
            except (TypeError, ValueError):
                score = 0.0
            scores[str(doc_id)] = score
        return scores

    def count(self) -> int:
        if not self.ready or self._collection is None:
            return 0
        try:
            return int(self._collection.count())
        except Exception:
            return 0


class LocalJsonVectorStore:
    """Deterministic fallback used when Chroma is not installed or unavailable."""

    def __init__(self, data_dir: Path, chroma_error: str | None = None) -> None:
        self.backend = "local_json_vector_fallback"
        self.is_external_vector_database = False
        self.ready = True
        self.error = chroma_error
        self._path = data_dir / "rag_vector_index.json"
        self._vectors: dict[str, list[float]] = {}
        self._load()

    def _load(self) -> None:
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            return
        vectors = payload.get("vectors")
        if isinstance(vectors, dict):
            self._vectors = {
                str(key): [float(value) for value in values]
                for key, values in vectors.items()
                if isinstance(values, list)
            }

    def upsert(self, documents: list[KnowledgeDocument], embeddings: list[list[float]]) -> None:
        for doc, embedding in zip(documents, embeddings):
            self._vectors[doc.doc_id] = embedding
        try:
            self._path.write_text(
                json.dumps(
                    {
                        "backend": self.backend,
                        "vectors": self._vectors,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        except Exception:
            pass

    def query(self, query_embedding: list[float], limit: int) -> dict[str, float]:
        ranked = [
            (doc_id, _cosine_similarity(query_embedding, embedding))
            for doc_id, embedding in self._vectors.items()
        ]
        ranked.sort(key=lambda item: item[1], reverse=True)
        return {doc_id: score for doc_id, score in ranked[:limit] if score > 0}

    def count(self) -> int:
        return len(self._vectors)


class LocalRAGEngine:
    """Hybrid clinical vector RAG engine with study-type isolation."""

    def __init__(self):
        self.documents: list[KnowledgeDocument] = []
        self.embedding_provider = ClinicalEmbeddingProvider()
        self.vector_store = self._build_vector_store()
        self._vector_index_signature: str | None = None
        self._last_vector_index_error: str | None = None
        self._seed_catalog()

    def _get_data_dir(self) -> Path:
        data_dir = Path(__file__).parent.parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir

    def _build_vector_store(self) -> ChromaVectorStore | LocalJsonVectorStore:
        backend = (os.getenv("RAG_VECTOR_BACKEND") or DEFAULT_VECTOR_BACKEND).strip().lower()
        collection_name = (
            os.getenv("RAG_VECTOR_COLLECTION")
            or f"{VECTOR_COLLECTION_NAME}_{_safe_collection_suffix(self.embedding_provider.configured_model_name)}"
        )

        if backend == "chroma":
            chroma = ChromaVectorStore(self._get_data_dir(), collection_name)
            if chroma.ready:
                return chroma
            return LocalJsonVectorStore(self._get_data_dir(), chroma.error)

        return LocalJsonVectorStore(self._get_data_dir(), f"Unsupported vector backend configured: {backend}")

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

    def _seed_catalog(self) -> None:
        self.documents.extend(self._build_reference_documents())
        self._load_disk_index()

    def _document_fingerprint(self) -> str:
        hasher = hashlib.sha256()
        hasher.update(self.embedding_provider.active_model_name.encode("utf-8"))
        hasher.update(str(len(self.documents)).encode("utf-8"))
        for doc in self.documents:
            hasher.update(doc.doc_id.encode("utf-8"))
            hasher.update(hashlib.sha1(doc.content.encode("utf-8", errors="ignore")).digest())
        return hasher.hexdigest()

    def _ensure_vector_index(self, force: bool = False) -> None:
        signature = self._document_fingerprint()
        if not force and self._vector_index_signature == signature:
            return

        try:
            embeddings = self.embedding_provider.embed_texts([doc.embedding_text() for doc in self.documents])
            for doc, embedding in zip(self.documents, embeddings):
                doc.embedding = embedding
            self.vector_store.upsert(self.documents, embeddings)
            self._vector_index_signature = self._document_fingerprint()
            self._last_vector_index_error = None
        except Exception as error:
            self._last_vector_index_error = str(error)

    def reload_reference_library(self) -> dict[str, Any]:
        user_documents = [doc for doc in self.documents if doc.doc_id.startswith("user_")]
        reference_documents = self._build_reference_documents()
        self.documents = [*reference_documents, *user_documents]
        self._vector_index_signature = None
        self._ensure_vector_index(force=True)
        metrics = self.get_reference_library_metrics()
        return {
            "message": "Reference library reindexed from the current manifest and vector store.",
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
            "retrievalEngine": "clinical_embedding_vector_db_hybrid_bm25_mmr",
            "embeddingProvider": self.embedding_provider.provider_name,
            "embeddingModel": self.embedding_provider.active_model_name,
            "configuredClinicalEmbeddingModel": self.embedding_provider.configured_model_name,
            "embeddingFallbackApplied": self.embedding_provider.fallback_applied,
            "embeddingFallbackReason": self.embedding_provider.fallback_reason,
            "vectorDimensions": self.embedding_provider.dimensions,
            "semanticSimilarity": "clinical_embedding_cosine_with_bm25_and_mmr",
            "vectorDatabaseBackend": self.vector_store.backend,
            "vectorDatabaseConfigured": self.vector_store.is_external_vector_database,
            "vectorDatabaseReady": self.vector_store.ready,
            "vectorDatabaseError": self.vector_store.error,
            "vectorIndexDocumentCount": self.vector_store.count(),
            "lastVectorIndexError": self._last_vector_index_error,
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
        limit: int = 5,
    ) -> list[tuple[float, KnowledgeDocument]]:
        ranked: list[tuple[float, KnowledgeDocument]] = []
        if not candidate_docs:
            return ranked

        self._ensure_vector_index()
        query_text = " ".join([*query_tokens, *concepts])
        query_embedding = self.embedding_provider.embed_texts([query_text])[0]
        vector_scores = self.vector_store.query(query_embedding, max(limit * 8, 24))

        for doc in candidate_docs:
            lexical = self._bm25_score(query_tokens, doc, candidate_docs)
            semantic = self._semantic_intent_score(query_tokens, concepts, doc, study_type)
            vector = vector_scores.get(doc.doc_id)
            if vector is None:
                vector = _cosine_similarity(query_embedding, doc.embedding)
            total = lexical + semantic + (max(0.0, vector) * 3.0)
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

    def _save_disk_index(self) -> None:
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

    def _load_disk_index(self) -> None:
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
        self._vector_index_signature = None
        self._ensure_vector_index(force=True)

        return {
            "message": f"Successfully ingested '{filename}' into RAG vector index.",
            "filename": filename,
            "document_type": document_type,
            "chunks_processed": added_chunks,
            "evidence_rank": 1,
            "evidence_level_label": "User Document Source",
            "is_primary_reference": True,
            "database_status": "indexed_in_vector_database"
            if self.vector_store.is_external_vector_database
            else "indexed_with_local_vector_fallback",
            "vector_database_backend": self.vector_store.backend,
            "embedding_model": self.embedding_provider.active_model_name,
        }

    def ingest_pdf_file(
        self,
        filepath: str | Path,
        filename: str | None = None,
        document_type: str = "protocol",
        study_type: str | None = "rct",
    ) -> dict[str, Any]:
        """Ingest a PDF file page-by-page into the vector index with page citations."""
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
        self._vector_index_signature = None
        self._ensure_vector_index(force=True)

        return {
            "message": f"Successfully ingested PDF '{doc_name}' ({added_chunks} chunks across pages) into RAG vector index.",
            "filename": doc_name,
            "document_type": document_type,
            "chunks_processed": added_chunks,
            "total_pages": len(reader.pages) if "reader" in locals() else 0,
            "evidence_rank": 1,
            "evidence_level_label": "User Uploaded Protocol PDF",
            "is_primary_reference": True,
            "database_status": "indexed_in_vector_database"
            if self.vector_store.is_external_vector_database
            else "indexed_with_local_vector_fallback",
            "vector_database_backend": self.vector_store.backend,
            "embedding_model": self.embedding_provider.active_model_name,
        }

    def query(
        self,
        question: str,
        study_type: str | None = None,
        filter_source: str | None = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Perform grounded clinical vector RAG search with study-type isolation."""
        safe_limit = max(1, min(int(limit or 5), 20))
        base_tokens = _tokenize(question)
        q_tokens = self._expand_query_tokens(question, study_type)
        concepts = self._detect_query_concepts(q_tokens, study_type)
        intent = self._detect_query_intent(question, base_tokens)
        if not q_tokens:
            return {
                "answer": "Please provide a focused research question to search the indexed clinical references.",
                "citations": [],
                "retrieval": {
                    "strategy": "filtered_only",
                    "fallbackApplied": False,
                    "attempts": [{"label": "empty_query", "citationCount": 0, "useful": False}],
                    **self._retrieval_metadata(),
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

        norm_study_type = (study_type or "").strip().lower()
        if norm_study_type:
            candidate_docs = [
                d for d in self.documents
                if norm_study_type in d.study_types or "shared" in d.study_types
            ]
        else:
            candidate_docs = list(self.documents)
        candidate_docs = self._narrow_candidates_for_intent(candidate_docs, intent)

        attempts = []
        effective_docs = candidate_docs
        used_fallback = False

        if filter_source:
            source_matched = [
                d for d in candidate_docs
                if d.source_file and filter_source.lower() in d.source_file.lower()
            ]
            if source_matched:
                effective_docs = source_matched
                attempts.append({"label": "filtered_source", "citationCount": len(effective_docs), "useful": True})
            else:
                used_fallback = True
                attempts.append({"label": "filtered_source", "citationCount": 0, "useful": False})

        ranked_scores = self._rank_documents(q_tokens, concepts, effective_docs, study_type, safe_limit)
        ranked_scores = self._prioritize_primary_references(ranked_scores, intent)

        if not ranked_scores and filter_source and not used_fallback:
            used_fallback = True
            ranked_scores = self._rank_documents(q_tokens, concepts, candidate_docs, study_type, safe_limit)
            ranked_scores = self._prioritize_primary_references(ranked_scores, intent)

        top_matches = self._select_diverse_top_matches(ranked_scores, safe_limit)

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
            answer = self._synthesize_grounded_answer(question, intent, top_matches, citations)
        else:
            answer = (
                "No sufficiently grounded indexed reference matched this question. "
                "The system should not generate a medical answer without supporting citations."
            )

        return {
            "answer": answer,
            "citations": citations,
            "retrieval": {
                "strategy": "semantic_hybrid_vector_database_ranked",
                "fallbackApplied": used_fallback,
                "effectiveFilterSource": filter_source if not used_fallback else None,
                "queryTerms": base_tokens[:12],
                "expandedTerms": q_tokens[:20],
                "concepts": concepts,
                "intent": intent,
                "attempts": attempts or [{"label": "search_executed", "citationCount": len(citations), "useful": len(citations) > 0}],
                **self._retrieval_metadata(),
            },
        }

    def _retrieval_metadata(self) -> dict[str, Any]:
        return {
            "embeddingProvider": self.embedding_provider.provider_name,
            "embeddingModel": self.embedding_provider.active_model_name,
            "configuredClinicalEmbeddingModel": self.embedding_provider.configured_model_name,
            "embeddingFallbackApplied": self.embedding_provider.fallback_applied,
            "embeddingFallbackReason": self.embedding_provider.fallback_reason,
            "vectorDimensions": self.embedding_provider.dimensions,
            "vectorDatabaseBackend": self.vector_store.backend,
            "vectorDatabaseConfigured": self.vector_store.is_external_vector_database,
            "vectorDatabaseReady": self.vector_store.ready,
            "vectorDatabaseError": self.vector_store.error,
            "vectorIndexDocumentCount": self.vector_store.count(),
            "lastVectorIndexError": self._last_vector_index_error,
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


rag_engine = LocalRAGEngine()
