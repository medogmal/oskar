"""
ClinResearch AI — Built-in Clinical Validation Engine
======================================================
Validates physiological and clinical parameters for dental and clinical research studies.
Returns per-field validation status, range checks, and detailed error messages.
"""

from __future__ import annotations

import re
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


def validate_crf_template(fields: list[dict[str, Any]], study_type: str | None = None) -> dict[str, Any]:
    """Validate CRF template fields for duplicates, logical conflicts, and SAP compatibility."""
    errors: list[str] = []
    warnings: list[str] = []
    
    normalized_study_type = str(study_type or "").strip().lower()

    # 1. Duplicate Variable Detection
    seen_labels: dict[str, str] = {}
    for idx, field in enumerate(fields, start=1):
        raw_label = str(field.get("label") or "").strip()
        if not raw_label:
            errors.append(f"الحقل رقم {idx} لا يحتوي على عنوان (Label).")
            continue
        
        norm_label = re.sub(r"[^a-zA-Z0-9\u0621-\u064a]+", "", raw_label.lower())
        if norm_label in seen_labels:
            errors.append(f"تكرار متغير في الاستمارة: الحقل '{raw_label}' مكرر مع حقل آخر '{seen_labels[norm_label]}'.")
        else:
            seen_labels[norm_label] = raw_label

    # 2. Logical Conflict & In Vitro Patient Info Control
    has_patient_demographics = False
    has_group_allocation = False
    has_numerical_outcome = False
    
    demographic_keywords = ["age", "sex", "gender", "name", "history", "العمر", "الجنس", "تاريخ", "الهوية"]
    group_keywords = ["group", "allocation", "arm", "random", "المجموعة", "التقسيم", "العشوائية"]
    
    for field in fields:
        label = str(field.get("label") or "").lower()
        resp_type = str(field.get("responseType") or "text").lower()
        
        if any(kw in label for kw in demographic_keywords):
            has_patient_demographics = True
        if any(kw in label for kw in group_keywords):
            has_group_allocation = True
        if resp_type == "numeric":
            has_numerical_outcome = True

    # Conflict: In Vitro study contains human patient demographics
    if normalized_study_type == "in_vitro" and has_patient_demographics:
        warnings.append(
            "تعارض منطقي: دراسة مخبرية (In Vitro) تحتوي على متغيرات ديموغرافية للمريض (العمر/الجنس). "
            "الدراسات المخبرية يجب أن تركز على عينات المواد وتكون معماة بالكامل عن تفاصيل المرضى."
        )

    # Conflict: RCT/Prospective study lacks group allocation
    if normalized_study_type in {"rct", "prospective"} and not has_group_allocation:
        errors.append(
            "خطأ منهجية (Critical): دراسة تجريبية (RCT) أو استباقية لا تحتوي على متغير تقسيم المجموعات (Group Allocation). "
            "لن يتمكن النظام من إجراء مقارنات إحصائية بين المجموعات."
        )

    # 3. SAP (Statistical Analysis Plan) Compatibility Control
    if has_numerical_outcome and not has_group_allocation and normalized_study_type != "in_vitro":
        warnings.append(
            "عدم توافق مع خطة التحليل الإحصائي (SAP): تم رصد متغيرات رقمية مستمرة (Outcomes) دون وجود متغير تقسيم المجموعات. "
            "لن يكون بالإمكان إجراء اختبارات الفروق (t-test / ANOVA) في حزمة التحليل الإحصائي."
        )
        
    if not fields:
        errors.append("استمارة الفحص فارغة. يجب إضافة حقل واحد على الأقل.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "metadata_checked": {
            "study_type": normalized_study_type,
            "fields_count": len(fields),
            "has_demographics": has_patient_demographics,
            "has_group_allocation": has_group_allocation,
            "has_numerical_outcome": has_numerical_outcome
        }
    }

