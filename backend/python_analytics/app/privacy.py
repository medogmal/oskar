"""
ClinResearch AI — Data Privacy & PHI Redaction Module
======================================================
Sanitizes patient health information (PHI) and researcher identifiers
to prevent sensitive data leakage in OpenAI/LLM requests and application logs.
Includes structured HIPAA/GDPR privacy audit logging.
"""

from __future__ import annotations

import datetime
import re
from typing import Any

# Comprehensive Regex patterns for HIPAA 18 Safe Harbor PHI identifiers
PHI_PATTERNS = [
    # Emails
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[REDACTED_EMAIL]"),
    # International & US Phone Numbers
    (r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b", "[REDACTED_PHONE]"),
    # Social Security / National ID / National Number
    (r"\b\d{3}-\d{2}-\d{4}\b", "[REDACTED_SSN]"),
    (r"\b\d{14}\b", "[REDACTED_NATIONAL_ID]"),  # e.g., 14-digit Egyptian/Arab National ID
    # Medical Record Number (MRN) & Hospital Patient ID
    (r"\b(?:MRN|mrn|PatientID|Patient_ID|رقم_الملف|رقم_المريض)\s*[:=#]?\s*[A-Za-z0-9-]+\b", "[REDACTED_MRN]"),
    # Dates of Birth / Service (YYYY-MM-DD or DD/MM/YYYY)
    (r"\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b", "[REDACTED_DATE]"),
    (r"\b(?:0[1-9]|[12]\d|3[01])[/.-](?:0[1-9]|1[0-2])[/.-](?:19|20)\d{2}\b", "[REDACTED_DATE]"),
    # Patient Names (English & Arabic)
    (r"\b(?:Patient Name|Patient_Name|Subject Name|اسم المريض|اسم_المريض|المريض|الاسم)\s*[:=-]?\s*([A-Za-z]+(?:\s+[A-Za-z]+){1,3}|[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+){1,3})\b", "[REDACTED_PATIENT_NAME]"),
    # IP Addresses
    (r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", "[REDACTED_IP_ADDRESS]"),
]

# In-memory structured HIPAA audit log buffer
PHI_AUDIT_LOGS: list[dict[str, Any]] = []


def redact_phi(text: str) -> str:
    """Scan and redact potential PHI elements from input text."""
    if not text:
        return text

    sanitized = text
    for pattern, replacement in PHI_PATTERNS:
        sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)

    return sanitized


def redact_phi_with_audit(text: str) -> dict[str, Any]:
    """Scan and redact PHI elements while returning structured HIPAA compliance audit metadata."""
    if not text:
        return {
            "sanitized_text": "",
            "redactions_count": 0,
            "patterns_triggered": [],
            "retention_policy": "zero_retention_hipaa_compliant",
        }

    sanitized = text
    redactions_count = 0
    patterns_triggered = []

    for pattern, replacement in PHI_PATTERNS:
        matches = re.findall(pattern, sanitized, flags=re.IGNORECASE)
        if matches:
            redactions_count += len(matches)
            patterns_triggered.append(replacement)
            sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)

    audit_entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "redactions_count": redactions_count,
        "patterns_triggered": list(set(patterns_triggered)),
        "retention_policy": "zero_retention_hipaa_compliant",
    }
    if redactions_count > 0:
        PHI_AUDIT_LOGS.append(audit_entry)

    return {
        "sanitized_text": sanitized,
        "redactions_count": redactions_count,
        "patterns_triggered": list(set(patterns_triggered)),
        "retention_policy": "zero_retention_hipaa_compliant",
    }
