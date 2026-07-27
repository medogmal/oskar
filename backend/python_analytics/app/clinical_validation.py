"""
ClinResearch AI — Built-in Clinical Validation Engine
======================================================
Validates physiological and clinical parameters for dental and clinical research studies.
Returns per-field validation status, range checks, and detailed error messages.
"""

from __future__ import annotations

from typing import Any

# Standard Clinical Reference Ranges
RANGE_RULES = {
    "patientAge": {"min": 0, "max": 120, "label_ar": "عمر المريض (سنة)", "unit": "years"},
    "pocketDepthMm": {"min": 0.0, "max": 15.0, "label_ar": "عمق الجيب اللثوي (مم)", "unit": "mm"},
    "clinicalAttachmentLossMm": {"min": 0.0, "max": 15.0, "label_ar": "فقدان الالتصاق السريري CAL (مم)", "unit": "mm"},
    "bleedingOnProbingPercent": {"min": 0.0, "max": 100.0, "label_ar": "نسبة النزف عند السبر BOP (%)", "unit": "%"},
    "plaqueIndexPercent": {"min": 0.0, "max": 100.0, "label_ar": "مؤشر اللويحة السنية Plaque Index (%)", "unit": "%"},
    "systolicBpMmhg": {"min": 50, "max": 250, "label_ar": "ضغط الدم الانقباضي (مم زئبق)", "unit": "mmHg"},
    "diastolicBpMmhg": {"min": 30, "max": 150, "label_ar": "ضغط الدم الانبساطي (مم زئبق)", "unit": "mmHg"},
    "heartRateBpm": {"min": 30, "max": 220, "label_ar": "معدل نبضات القلب (نبضة/دقيقة)", "unit": "bpm"},
    "hba1cPercent": {"min": 3.0, "max": 18.0, "label_ar": "السكر التراكمي HbA1c (%)", "unit": "%"},
}



def validate_clinical_parameters(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate incoming clinical parameters against physiological ranges."""
    errors: dict[str, str] = {}
    warnings: dict[str, str] = {}
    validated_fields: dict[str, Any] = {}

    for key, rule in RANGE_RULES.items():
        raw_val = payload.get(key)
        if raw_val is None or str(raw_val).strip() == "":
            continue

        try:
            val = float(raw_val)
            validated_fields[key] = val
            if val < rule["min"] or val > rule["max"]:
                errors[key] = (
                    f"قيمة {rule['label_ar']} غير منطقية سريرياً ({val}). "
                    f"المدى المنطقي المسموح به هو بين {rule['min']} و {rule['max']}."
                )
            elif key == "pocketDepthMm" and val > 6.0:
                warnings[key] = f"عمق الجيب اللثوي مرتفع ({val} مم) وتشير إلى التهاب دواعم سنية شديد (Periodontitis)."
            elif key == "systolicBpMmhg" and val > 140:
                warnings[key] = f"ضغط الدم الانقباضي مرتفع ({val} mmHg) — ارتفاع ضغط الدم (Hypertension)."
        except (ValueError, TypeError):
            errors[key] = f"القيم المدخلة لحقل {rule['label_ar']} يجب أن تكون رقماً صحيخاً أو عشرياً."

    # Validate Smoking Status if present
    smoking_status = payload.get("smokingStatus")
    if smoking_status is not None and str(smoking_status).strip() != "":
        norm_smoke = str(smoking_status).lower().strip()
        if norm_smoke not in {"yes", "no", "former", "smoker", "non-smoker", "نعم", "لا"}:
            errors["smokingStatus"] = "حالة التدخين غير معتمدة. اختر (نعم / لا)."

    is_valid = len(errors) == 0

    return {
        "valid": is_valid,
        "message": "تمت فحص البيانات السريرية بنجاح بنتيجة خالية من الأخطاء."
        if is_valid
        else "توجد قيم سريرية خارج المدى المعتمد تحتاج لمراجعة الباحث.",
        "errors": errors,
        "warnings": warnings,
        "validated_fields": validated_fields,
    }
