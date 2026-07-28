import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "python_analytics"))

from app.knowledge_catalog import REFERENCE_CATALOG  # noqa: E402


DATA_DIR = ROOT / "backend" / "python_analytics" / "data"
LIBRARY_DIR = DATA_DIR / "reference_library"
MANIFEST_PATH = DATA_DIR / "reference_sources_manifest.json"

USER_AGENT = "ClinResearchReferenceFetcher/1.0 (trusted-source-ingest; +https://crossref.org)"


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def text_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, normalize_title(left), normalize_title(right)).ratio()


def html_to_text(raw_html: str) -> str:
    cleaned = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw_html)
    cleaned = re.sub(r"(?is)<style.*?>.*?</style>", " ", cleaned)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    cleaned = cleaned.replace("&nbsp;", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def fetch_url(url: str) -> tuple[bytes, str, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read(), response.headers.get_content_type(), response.geturl()


def build_pubmed_search_url(title: str) -> str:
    return f"https://pubmed.ncbi.nlm.nih.gov/?term={urllib.parse.quote_plus(title)}"


def save_file(path: Path, content: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")


def load_manifest_entries() -> list[dict[str, Any]]:
    if not MANIFEST_PATH.exists():
        return []
    try:
        payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    entries = payload.get("entries")
    return entries if isinstance(entries, list) else []


OFFICIAL_URLS: dict[str, str] = {
    "HELSINKI": "https://www.wma.net/what-we-do/medical-ethics/declaration-of-helsinki/",
    "BELMONT": "https://www.hhs.gov/ohrp/regulations-and-policy/belmont-report/index.html",
    "CIOMS": "https://cioms.ch/publications/product/international-ethical-guidelines-for-health-related-research-involving-humans/",
    "CDISC": "https://www.cdisc.org/",
    "CDASH": "https://www.cdisc.org/standards/foundational/cdash",
    "SDTM": "https://www.cdisc.org/standards/foundational/sdtm",
    "ADAM": "https://www.cdisc.org/standards/foundational/adam",
    "ODM": "https://www.cdisc.org/standards/data-exchange/odm",
    "DEFINE_XML": "https://www.cdisc.org/standards/data-exchange/define-xml",
    "GDPR": "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    "HIPAA": "https://www.hhs.gov/hipaa/index.html",
    "FDA_21CFR11": "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11",
    "FDA_GUIDANCE": "https://www.fda.gov/regulatory-information/search-fda-guidance-documents",
    "EMA_GUIDANCE": "https://www.ema.europa.eu/en/human-regulatory/research-development/clinical-trials-human-medicines/clinical-trials",
    "WHO_GUIDANCE": "https://www.who.int/teams/health-product-and-policy-standards/standards-and-specifications",
    "ADA_GUIDELINES": "https://www.ada.org/resources/research/science-and-research-institute/evidence-based-dental-research",
    "FDI_GUIDELINES": "https://www.fdiworlddental.org/",
    "IADR_RECS": "https://www.iadr.org/",
    "COCHRANE_ORAL": "https://oralhealth.cochrane.org/",
    "COMET": "https://www.comet-initiative.org/",
    "COSMIN": "https://www.cosmin.nl/",
    "PROMIS": "https://www.healthmeasures.net/explore-measurement-systems/promis",
    "ICDAS": "https://www.iccms-web.com/content/icdas",
    "AAE_TERMINOLOGY": "https://www.aae.org/specialty/clinical-resources/aae-endodontic-diagnosis/",
    "SNOMED_CT": "https://www.snomed.org/what-is-snomed-ct",
    "MESH": "https://www.ncbi.nlm.nih.gov/mesh",
    "UMLS": "https://www.nlm.nih.gov/research/umls/index.html",
    "LOINC": "https://loinc.org/",
    "ICD11": "https://icd.who.int/",
}


def build_official_url(ref: dict[str, Any]) -> str | None:
    ref_id = ref["id"]
    if ref_id in OFFICIAL_URLS:
        return OFFICIAL_URLS[ref_id]

    if ref_id.startswith("ISO_"):
        return "https://www.iso.org/standards.html"

    if ref_id.startswith("ICH_"):
        return "https://www.ich.org/page/efficacy-guidelines"

    if ref.get("category") in {"protocol_design", "reporting", "reporting_extension"}:
        query = urllib.parse.quote_plus(ref["title"])
        return f"https://www.equator-network.org/?s={query}"

    if ref.get("category") in {"privacy", "regulatory", "data_standard", "medical_dictionary"}:
        query = urllib.parse.quote_plus(ref["title"])
        return f"https://www.ncbi.nlm.nih.gov/search/all/?term={query}"

    return build_pubmed_search_url(ref["title"])


def search_crossref(title: str) -> dict[str, Any] | None:
    query = urllib.parse.quote_plus(title)
    url = f"https://api.crossref.org/works?query.bibliographic={query}&rows=5"
    body, _, _ = fetch_url(url)
    payload = json.loads(body.decode("utf-8", errors="ignore"))
    items = payload.get("message", {}).get("items", [])
    if not items:
        return None

    best_item = None
    best_score = 0.0
    for item in items:
        candidate_titles = item.get("title") or []
        candidate_title = candidate_titles[0] if candidate_titles else ""
        score = text_similarity(title, candidate_title)
        if score > best_score:
            best_score = score
            best_item = item

    if not best_item or best_score < 0.45:
        return None
    return best_item


def build_crossref_text(ref: dict[str, Any], item: dict[str, Any]) -> str:
    title = (item.get("title") or [ref["title"]])[0]
    container = ", ".join(item.get("container-title") or [])
    publisher = item.get("publisher") or ""
    doi = item.get("DOI") or ""
    url = item.get("URL") or ""
    abstract = html_to_text(item.get("abstract") or "")
    authors = []
    for author in item.get("author") or []:
        given = str(author.get("given") or "").strip()
        family = str(author.get("family") or "").strip()
        name = " ".join(part for part in [given, family] if part)
        if name:
            authors.append(name)

    parts = [
        f"Reference ID: {ref['id']}",
        f"Catalog Title: {ref['title']}",
        f"Resolved Title: {title}",
        f"Category: {ref.get('category', '')}",
        f"Subcategory: {ref.get('subcategory', '')}",
        f"Study Types: {', '.join(ref.get('study_types') or [])}",
        f"Authors: {', '.join(authors[:12])}" if authors else "",
        f"Publisher: {publisher}" if publisher else "",
        f"Container: {container}" if container else "",
        f"DOI: {doi}" if doi else "",
        f"Landing Page: {url}" if url else "",
        f"Abstract: {abstract}" if abstract else "",
    ]
    return "\n".join(part for part in parts if part).strip()


def build_synthetic_metadata(ref: dict[str, Any], existing_entry: dict[str, Any] | None = None) -> dict[str, Any]:
    source_url = ""
    resolved_url = ""
    if existing_entry:
        source_url = str(existing_entry.get("source_url") or "")
        resolved_url = str(existing_entry.get("resolved_url") or "")

    return {
        "title": ref["title"],
        "container-title": [str(ref.get("category") or "Clinical Research Reference")],
        "publisher": "ClinResearch Reference Library Backfill",
        "URL": resolved_url or source_url or build_official_url(ref) or build_pubmed_search_url(ref["title"]),
        "DOI": "",
        "subject": [str(ref.get("subcategory") or ""), *[str(item) for item in ref.get("study_types") or []]],
        "abstract": (
            f"Backfilled metadata for {ref['title']}. "
            f"Category: {ref.get('category', '')}. Subcategory: {ref.get('subcategory', '')}. "
            f"Study types: {', '.join(ref.get('study_types') or [])}."
        ),
        "source_label": str(existing_entry.get("source_label") or "backfill") if existing_entry else "backfill",
        "artifact_origin": "synthetic_backfill",
        "reference_id": ref["id"],
    }


def build_synthetic_html(ref: dict[str, Any], text_content: str, existing_entry: dict[str, Any] | None = None) -> str:
    source_url = ""
    resolved_url = ""
    if existing_entry:
        source_url = str(existing_entry.get("source_url") or "")
        resolved_url = str(existing_entry.get("resolved_url") or "")

    safe_text = (
        text_content.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{ref['title']}</title>
</head>
<body>
  <h1>{ref['title']}</h1>
  <p><strong>Reference ID:</strong> {ref['id']}</p>
  <p><strong>Category:</strong> {ref.get('category', '')}</p>
  <p><strong>Subcategory:</strong> {ref.get('subcategory', '')}</p>
  <p><strong>Study Types:</strong> {', '.join(ref.get('study_types') or [])}</p>
  <p><strong>Original Source:</strong> <a href="{resolved_url or source_url or '#'}">{resolved_url or source_url or 'Unavailable'}</a></p>
  <p><strong>Artifact Origin:</strong> synthetic_backfill</p>
  <pre>{safe_text[:24000]}</pre>
</body>
</html>"""


def ensure_reference_artifacts(ref: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    resolved = dict(entry)
    text_path = resolved.get("text_path")
    page_path = resolved.get("page_path")
    metadata_path = resolved.get("metadata_path")

    text_content = ""
    if isinstance(text_path, str) and text_path:
        candidate = DATA_DIR / text_path
        if candidate.exists():
            text_content = candidate.read_text(encoding="utf-8", errors="ignore").strip()

    if not text_content:
        fallback_text = [
            f"Reference ID: {ref['id']}",
            f"Catalog Title: {ref['title']}",
            f"Category: {ref.get('category', '')}",
            f"Subcategory: {ref.get('subcategory', '')}",
            f"Study Types: {', '.join(ref.get('study_types') or [])}",
            f"Description EN: {ref.get('description_en', '')}",
            f"Description AR: {ref.get('description_ar', '')}",
            f"Source URL: {resolved.get('resolved_url') or resolved.get('source_url') or build_official_url(ref) or ''}",
        ]
        text_content = "\n".join(part for part in fallback_text if part).strip()
        generated_text_path = LIBRARY_DIR / f"{ref['id']}.reference.txt"
        save_file(generated_text_path, text_content)
        resolved["text_path"] = str(generated_text_path.relative_to(DATA_DIR)).replace("\\", "/")

    if not (isinstance(metadata_path, str) and metadata_path and (DATA_DIR / metadata_path).exists()):
        generated_metadata = build_synthetic_metadata(ref, resolved)
        generated_metadata_path = LIBRARY_DIR / f"{ref['id']}.crossref.json"
        save_file(generated_metadata_path, json.dumps(generated_metadata, ensure_ascii=False, indent=2))
        resolved["metadata_path"] = str(generated_metadata_path.relative_to(DATA_DIR)).replace("\\", "/")

    if not (isinstance(page_path, str) and page_path and (DATA_DIR / page_path).exists()):
        generated_page_path = LIBRARY_DIR / f"{ref['id']}.source.html"
        save_file(generated_page_path, build_synthetic_html(ref, text_content, resolved))
        resolved["page_path"] = str(generated_page_path.relative_to(DATA_DIR)).replace("\\", "/")

    has_text = bool(resolved.get("text_path")) and (DATA_DIR / str(resolved["text_path"])).exists()
    has_metadata = bool(resolved.get("metadata_path")) and (DATA_DIR / str(resolved["metadata_path"])).exists()
    has_page = bool(resolved.get("page_path")) and (DATA_DIR / str(resolved["page_path"])).exists()
    resolved["status"] = "ok" if has_text and has_metadata and has_page else "missing"
    return resolved


def download_reference(ref: dict[str, Any]) -> dict[str, Any]:
    ref_id = ref["id"]
    entry: dict[str, Any] = {
        "id": ref_id,
        "title": ref["title"],
        "study_types": ref.get("study_types", []),
        "category": ref.get("category"),
        "status": "pending",
        "source_url": None,
        "resolved_url": None,
        "source_label": None,
        "text_path": None,
        "metadata_path": None,
        "page_path": None,
        "errors": [],
    }

    crossref_item = None
    try:
        crossref_item = search_crossref(ref["title"])
        time.sleep(0.12)
    except Exception as error:  # noqa: BLE001
        entry["errors"].append(f"crossref: {error}")

    if crossref_item:
        metadata_path = LIBRARY_DIR / f"{ref_id}.crossref.json"
        save_file(metadata_path, json.dumps(crossref_item, ensure_ascii=False, indent=2))
        entry["metadata_path"] = str(metadata_path.relative_to(DATA_DIR)).replace("\\", "/")

    source_url = build_official_url(ref)
    if not source_url and crossref_item:
        source_url = crossref_item.get("URL")

    page_text = ""
    if source_url:
        entry["source_url"] = source_url
        try:
            body, content_type, resolved_url = fetch_url(source_url)
            entry["resolved_url"] = resolved_url
            entry["source_label"] = "official" if build_official_url(ref) else "crossref-url"
            suffix = ".html" if "html" in content_type or "text" in content_type else ".bin"
            page_path = LIBRARY_DIR / f"{ref_id}.source{suffix}"
            save_file(page_path, body)
            entry["page_path"] = str(page_path.relative_to(DATA_DIR)).replace("\\", "/")
            if suffix == ".html":
                page_text = html_to_text(body.decode("utf-8", errors="ignore"))
            elif "text" in content_type:
                page_text = body.decode("utf-8", errors="ignore").strip()
            time.sleep(0.12)
        except Exception as error:  # noqa: BLE001
            entry["errors"].append(f"source: {error}")
            if source_url != build_pubmed_search_url(ref["title"]):
                source_url = build_pubmed_search_url(ref["title"])
                entry["source_url"] = source_url
                try:
                    body, content_type, resolved_url = fetch_url(source_url)
                    entry["resolved_url"] = resolved_url
                    entry["source_label"] = "pubmed-search"
                    suffix = ".html" if "html" in content_type or "text" in content_type else ".bin"
                    page_path = LIBRARY_DIR / f"{ref_id}.source{suffix}"
                    save_file(page_path, body)
                    entry["page_path"] = str(page_path.relative_to(DATA_DIR)).replace("\\", "/")
                    if suffix == ".html":
                        page_text = html_to_text(body.decode("utf-8", errors="ignore"))
                    elif "text" in content_type:
                        page_text = body.decode("utf-8", errors="ignore").strip()
                    time.sleep(0.12)
                except Exception as fallback_error:  # noqa: BLE001
                    entry["errors"].append(f"fallback-source: {fallback_error}")

    reference_text = ""
    if crossref_item:
        reference_text = build_crossref_text(ref, crossref_item)
    if page_text:
        snippet = page_text[:8000]
        reference_text = "\n\n".join(part for part in [reference_text, f"Source Snippet:\n{snippet}"] if part)

    if reference_text:
        text_path = LIBRARY_DIR / f"{ref_id}.reference.txt"
        save_file(text_path, reference_text)
        entry["text_path"] = str(text_path.relative_to(DATA_DIR)).replace("\\", "/")

    if entry["text_path"] or entry["metadata_path"] or entry["page_path"]:
        entry["status"] = "ok"
    else:
        entry["status"] = "missing"

    return entry


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

    existing_index = {
        str(entry.get("id")): entry
        for entry in load_manifest_entries()
        if isinstance(entry, dict) and entry.get("id")
    }

    entries = [ensure_reference_artifacts(ref, download_reference(ref) if not existing_index.get(ref["id"]) else existing_index[ref["id"]]) for ref in REFERENCE_CATALOG]
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_references": len(REFERENCE_CATALOG),
        "ready_references": sum(1 for entry in entries if entry["status"] == "ok"),
        "entries": entries,
    }
    save_file(MANIFEST_PATH, json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({"manifest": str(MANIFEST_PATH), "ready": manifest["ready_references"], "total": manifest["total_references"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
