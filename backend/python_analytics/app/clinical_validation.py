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


def _normalize_label(value: Any) -> str:
    return re.sub(r"[^a-zA-Z0-9\u0621-\u064a]+", "", str(value or "").strip().lower())


def _word_set(value: Any) -> set[str]:
    return set(re.findall(r"[a-zA-Z\u0621-\u064a]{3,}", str(value or "").lower()))


def _field_value(field: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = field.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _field_list(field: dict[str, Any], *keys: str) -> list[str]:
    for key in keys:
        value = field.get(key)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _recommended_test_for_scale(scale: str, response_type: str) -> str:
    normalized_scale = scale.lower()
    normalized_response = response_type.lower()
    if normalized_scale in {"binary", "nominal"} or normalized_response in {"choice", "boolean"}:
        return "chi_square_or_logistic_regression"
    if normalized_scale == "ordinal":
        return "mann_whitney_or_ordinal_regression"
    if normalized_scale in {"interval", "ratio", "count"} or normalized_response == "numeric":
        return "t_test_anova_or_linear_regression"
    if normalized_scale == "time_to_event":
        return "kaplan_meier_log_rank_or_cox_regression"
    return "descriptive_or_model_based_test"


def validate_crf_template(
    fields: list[dict[str, Any]],
    study_type: str | None = None,
    objectives: list[dict[str, Any]] | None = None,
    research_questions: list[dict[str, Any]] | None = None,
    sap: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate CRF fields for duplicates, conflicts, metadata, objectives, and SAP readiness."""
    errors: list[str] = []
    warnings: list[str] = []
    issues: list[dict[str, Any]] = []

    def add_issue(
        code: str,
        severity: str,
        category: str,
        message: str,
        field: dict[str, Any] | None = None,
        suggested_action: str | None = None,
    ) -> None:
        issues.append(
            {
                "code": code,
                "severity": severity,
                "category": category,
                "message": message,
                "field_id": field.get("id") if field else None,
                "field_label": field.get("label") if field else None,
                "suggested_action": suggested_action,
            }
        )
        if severity in {"critical", "high"}:
            errors.append(message)
        else:
            warnings.append(message)

    normalized_study_type = str(study_type or "").strip().lower()
    objective_ids = {str(item.get("id")) for item in objectives or [] if item.get("id")}
    rq_ids = {str(item.get("id")) for item in research_questions or [] if item.get("id")}
    sap_tests = {
        str(item).strip().lower()
        for item in (sap or {}).get("planned_tests", [])
        if str(item).strip()
    }

    if not fields:
        add_issue("CRF_EMPTY", "critical", "crf_structural", "CRF template is empty. Add at least one data-collection field.")

    seen_labels: dict[str, dict[str, Any]] = {}
    has_patient_demographics = False
    has_group_allocation = False
    has_numerical_outcome = False
    outcome_fields: list[dict[str, Any]] = []

    demographic_keywords = ["age", "sex", "gender", "name", "history", "العمر", "الجنس", "تاريخ", "الهوية"]
    group_keywords = ["group", "allocation", "arm", "random", "مجموعة", "تقسيم", "عشوائي"]

    for idx, field in enumerate(fields, start=1):
        label = _field_value(field, "label", "name")
        if not label:
            add_issue(
                "CRF_FIELD_MISSING_LABEL",
                "critical",
                "crf_structural",
                f"Field #{idx} has no label.",
                field,
                "Add a unique, human-readable variable label.",
            )
            continue

        norm_label = _normalize_label(label)
        previous = seen_labels.get(norm_label)
        if previous:
            add_issue(
                "CRF_DUPLICATE_VARIABLE",
                "critical",
                "crf_structural",
                f"Duplicate variable detected: '{label}' duplicates '{previous.get('label')}'.",
                field,
                "Rename, merge, or remove the duplicate CRF field.",
            )
        else:
            seen_labels[norm_label] = field

        label_lower = label.lower()
        role = _field_value(field, "role").lower()
        response_type = _field_value(field, "responseType", "response_type", "type") or "text"
        scale = _field_value(field, "scale", "measurementScale", "measurement_scale")
        source = _field_value(field, "source")
        measurement_method = _field_value(field, "measurementMethod", "measurement_method")
        unit = _field_value(field, "unit")
        linked_outcomes = _field_list(field, "linkedOutcomeIds", "linked_outcome_ids")
        linked_rqs = _field_list(field, "linkedResearchQuestionIds", "linked_research_question_ids", "researchQuestionIds")
        linked_objectives = _field_list(field, "linkedObjectiveIds", "linked_objective_ids", "objectiveIds")
        recommended_test = _field_value(field, "recommendedStatisticalTest", "recommended_statistical_test").lower()

        if any(keyword in label_lower for keyword in demographic_keywords):
            has_patient_demographics = True
        if any(keyword in label_lower for keyword in group_keywords):
            has_group_allocation = True
        if response_type.lower() == "numeric" or scale.lower() in {"ratio", "interval", "count", "time_to_event"}:
            has_numerical_outcome = True
        if role in {"primary_outcome", "secondary_outcome", "dependent"} or linked_outcomes:
            outcome_fields.append(field)

        for code, value, action in [
            ("VARIABLE_SOURCE_MISSING", source, "Specify whether the value comes from exam, record, lab, imaging, questionnaire, or device."),
            ("MEASUREMENT_METHOD_MISSING", measurement_method, "Document the instrument, time point, examiner workflow, and measurement rule."),
        ]:
            if not value:
                add_issue(code, "high", "crf_structural", f"Variable '{label}' is missing required metadata.", field, action)

        if (response_type.lower() == "numeric" or scale.lower() in {"ratio", "interval", "count", "time_to_event"}) and not unit:
            add_issue(
                "VARIABLE_UNIT_MISSING",
                "high",
                "statistical",
                f"Numeric variable '{label}' is missing a measurement unit.",
                field,
                "Add a unit such as mm, years, %, count, days, or mg/dL.",
            )

        if (role in {"primary_outcome", "secondary_outcome", "dependent"} or linked_outcomes) and not linked_rqs:
            add_issue(
                "OUTCOME_NOT_LINKED_TO_RESEARCH_QUESTION",
                "critical",
                "methodological",
                f"Outcome variable '{label}' is not linked to any research question.",
                field,
                "Link every outcome variable to at least one research question.",
            )

        if objective_ids and (role in {"primary_outcome", "secondary_outcome", "dependent"} or linked_outcomes) and not linked_objectives:
            add_issue(
                "OUTCOME_NOT_LINKED_TO_OBJECTIVE",
                "high",
                "methodological",
                f"Outcome variable '{label}' is not linked to any objective.",
                field,
                "Link each outcome to a primary or secondary objective.",
            )

        unknown_rqs = [item for item in linked_rqs if rq_ids and item not in rq_ids]
        if unknown_rqs:
            add_issue(
                "UNKNOWN_RESEARCH_QUESTION_LINK",
                "moderate",
                "methodological",
                f"Variable '{label}' links to unknown research question IDs: {', '.join(unknown_rqs)}.",
                field,
                "Refresh the study structure links and remove stale IDs.",
            )

        expected_test = _recommended_test_for_scale(scale, response_type)
        if (role in {"primary_outcome", "secondary_outcome", "dependent"} or linked_outcomes) and not recommended_test:
            add_issue(
                "STATISTICAL_TEST_MISSING",
                "high",
                "statistical",
                f"Outcome variable '{label}' has no recommended statistical test.",
                field,
                f"Set a test compatible with its scale, for example: {expected_test}.",
            )
        elif recommended_test and sap_tests and recommended_test not in sap_tests:
            add_issue(
                "VARIABLE_TEST_NOT_IN_SAP",
                "moderate",
                "statistical",
                f"Variable '{label}' recommends '{recommended_test}', but it is not listed in the SAP planned tests.",
                field,
                "Add the test to the SAP or update the variable metadata.",
            )

    for idx, first in enumerate(fields):
        first_label = _field_value(first, "label", "name")
        if not first_label:
            continue
        first_words = _word_set(first_label)
        for second in fields[idx + 1:]:
            second_label = _field_value(second, "label", "name")
            if not second_label:
                continue
            overlap = len(first_words & _word_set(second_label))
            if overlap < 2 or _normalize_label(first_label) == _normalize_label(second_label):
                continue
            first_unit = _field_value(first, "unit").lower()
            second_unit = _field_value(second, "unit").lower()
            first_scale = _field_value(first, "scale").lower()
            second_scale = _field_value(second, "scale").lower()
            if (first_unit and second_unit and first_unit != second_unit) or (first_scale and second_scale and first_scale != second_scale):
                add_issue(
                    "CRF_VARIABLE_CONFLICT",
                    "high",
                    "crf_structural",
                    f"Potential conflicting definitions: '{first_label}' and '{second_label}' appear related but use different units or scales.",
                    second,
                    "Merge the variables or document why they measure distinct constructs.",
                )
            else:
                add_issue(
                    "CRF_POSSIBLE_DUPLICATE_VARIABLE",
                    "moderate",
                    "crf_structural",
                    f"Possible duplicate variables: '{first_label}' and '{second_label}' appear to collect overlapping data.",
                    second,
                    "Confirm whether both fields are required.",
                )

    if normalized_study_type == "in_vitro" and has_patient_demographics:
        add_issue(
            "IN_VITRO_PATIENT_DEMOGRAPHICS",
            "moderate",
            "methodological",
            "Logical conflict: in-vitro studies should not collect patient demographics unless specimens are explicitly linked under an approved protocol.",
        )

    if normalized_study_type in {"systematic_review", "meta_analysis"} and has_patient_demographics:
        add_issue(
            "EVIDENCE_SYNTHESIS_PATIENT_LEVEL_CRF",
            "high",
            "methodological",
            "Evidence-synthesis studies should use study-level extraction fields, not patient-level demographics.",
        )

    if normalized_study_type in {"rct", "prospective"} and not has_group_allocation:
        add_issue(
            "GROUP_ALLOCATION_MISSING",
            "critical",
            "methodological",
            "RCT/prospective CRF lacks a group allocation or comparison arm variable.",
            suggested_action="Add Group/Arm/Allocation so between-group analyses can be run.",
        )

    if has_numerical_outcome and not has_group_allocation and normalized_study_type not in {"in_vitro", "systematic_review", "meta_analysis"}:
        add_issue(
            "SAP_GROUPING_MISMATCH",
            "moderate",
            "statistical",
            "SAP compatibility warning: numeric outcomes exist without a grouping variable for t-test/ANOVA style comparisons.",
            suggested_action="Add group allocation or choose a within-subject/correlation/regression SAP.",
        )

    orphan_fields = [
        _field_value(field, "label", "name")
        for field in fields
        if _field_value(field, "role").lower() not in {"identifier", "demographic"}
        and not _field_list(field, "linkedResearchQuestionIds", "linked_research_question_ids", "researchQuestionIds")
        and not _field_list(field, "linkedObjectiveIds", "linked_objective_ids", "objectiveIds")
    ]

    return {
        "valid": not any(issue["severity"] in {"critical", "high"} for issue in issues),
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
        "metadata_checked": {
            "study_type": normalized_study_type,
            "fields_count": len(fields),
            "has_demographics": has_patient_demographics,
            "has_group_allocation": has_group_allocation,
            "has_numerical_outcome": has_numerical_outcome,
            "outcome_fields": len(outcome_fields),
            "orphan_variables": orphan_fields,
        },
    }

