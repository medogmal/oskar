# ClinResearch AI: تهيئة الشات بوت حسب نوع الدراسة وربطه بالمكتبة المعرفية

## المشكلة الحالية

حالياً نوع الدراسة (`studyType`) في نموذج إنشاء الدراسة هو حقل نصي حر (`<input type="text">`). لا يوجد ربط بين نوع الدراسة المختار والمكتبة المعرفية (Knowledge Base)، ولا يوجد نظام لعزل المراجع حسب النوع. الشات بوت يستخدم system prompt واحد لكل أنواع الدراسات.

## الهدف

1. تحويل حقل نوع الدراسة إلى قائمة منسدلة بأنواع محددة
2. بناء هيكل المكتبة المعرفية (126 مرجع) مصنفة حسب نوع الدراسة
3. ربط جلسة الشات بوت تلقائياً بالمراجع والـ System Prompt الخاصة بنوع الدراسة المختار
4. تحسين الـ RAG Retrieval ليفلتر بناءً على نوع الدراسة

---

## User Review Required

> [!IMPORTANT]
> **تغيير Breaking**: حقل `studyType` سيتحول من نص حر إلى `enum` محدد. الدراسات الموجودة بقيم غير مطابقة ستحتاج migration يدوي أو mapping.

> [!IMPORTANT]
> **المراجع الـ 126**: الخطة تبني كتالوج الـ metadata كاملاً بالمعرفات والتصنيفات. هل المراجع (ملفات PDF) موجودة فعلاً على Knowledge Engine أم تحتاج رفع يدوي أولاً؟

---

## Open Questions

> [!IMPORTANT]
> 1. هل خدمة Knowledge Engine الخارجية (`dental-research-knowledge-engine-backend-api-production.up.railway.app`) تدعم فلترة بـ `study_type` tag حالياً، أم نحتاج إضافة هذا الدعم؟
> 2. هل المراجع الـ 126 مرفوعة بالفعل على Knowledge Engine أم تحتاج ingestion جديد مع metadata؟
> 3. هل تريد إبقاء خيار إدخال نوع دراسة مخصص (custom) إلى جانب الأنواع الخمسة المحددة؟

---

## Proposed Changes

### Component 1: Knowledge Base Reference Catalog (Python Analytics)

هيكل البيانات الأساسي للـ 126 مرجع مع تصنيفاتهم.

#### [NEW] [knowledge_catalog.py](file:///d:/Mostaql/oskar/backend/python_analytics/app/knowledge_catalog.py)

ملف يحتوي على:
- **`STUDY_TYPES` enum**: الأنواع الخمسة المعتمدة
- **`REFERENCE_CATALOG`**: قائمة الـ 126 مرجع، كل مرجع يحمل:
  - `id`: معرف فريد (مثل `SPIRIT_2013`)
  - `title`: العنوان الكامل
  - `category`: التصنيف الفرعي (protocol_design, reporting, statistics, etc.)
  - `study_types`: قائمة أنواع الدراسات المرتبطة (أو `["shared"]` للمشتركة)
  - `subcategory`: القسم الفرعي (أخلاقيات، إدارة بيانات، etc.)
- **`get_references_for_study_type(study_type)`**: دالة تُرجع المراجع الخاصة بنوع دراسة معين + المراجع المشتركة
- **`get_reference_ids_for_study_type(study_type)`**: تُرجع IDs فقط للفلترة
- **`STUDY_TYPE_SYSTEM_PROMPTS`**: dict يحتوي system prompt مخصص لكل نوع دراسة

---

#### [NEW] [prompt_library.py](file:///d:/Mostaql/oskar/backend/python_analytics/app/prompt_library.py)

مكتبة المحثات (Prompt Library) الحاكمة:
- **`BASE_SYSTEM_PROMPT`**: System prompt أساسي لكل الأنواع
- **`STUDY_TYPE_PROMPTS`**: dict لكل نوع دراسة مع التوجيهات المنهجية الخاصة:
  - `rct`: يركز على CONSORT, SPIRIT, ICH, randomization, ITT
  - `prospective`: يركز على STROBE, NOS, Kaplan-Meier, GEE
  - `retrospective`: يركز على STROBE, RECORD, propensity score, logistic regression
  - `cross_sectional`: يركز على STROBE, AXIS, JBI, prevalence ratio
  - `in_vitro`: يركز على CRIS, ISO standards, material testing
- **`MODE_PROMPTS`**: dict لكل وضع من أوضاع المساعد الستة:
  - `protocol_understanding`: محث لتحليل البروتوكول
  - `study_elements`: محث لاستخراج عناصر الدراسة
  - `analysis_selection`: محث لاختيار التحليل مع التبرير
  - `results_explanation`: محث لشرح النتائج
  - `final_report`: محث لكتابة التقرير النهائي
  - `researcher_response`: محث لصياغة رد الباحث
- **`build_system_prompt(study_type, mode, reference_context)`**: دالة تجمع الـ prompt الكامل

---

#### [MODIFY] [main.py](file:///d:/Mostaql/oskar/backend/python_analytics/app/main.py)

التعديلات:

1. **تحديث `AssistantRequest` model** (سطر 47-53):
   - إضافة حقل `study_type: str | None = None` لاستقبال نوع الدراسة
   - استخدامه في بناء الـ system prompt

2. **تحديث `try_openai_response()`** (سطر 715-755):
   - بناء `system_prompt` ديناميكياً باستخدام `build_system_prompt(study_type, mode, reference_context)` من `prompt_library.py`
   - إضافة قائمة المراجع المسموحة كجزء من الـ system prompt
   - إضافة تعليمات صريحة بعدم استخدام مراجع خارج المكتبة المحددة

3. **تحديث `build_fallback_assistant_response()`** (سطر 673-712):
   - استخدام نوع الدراسة في بناء الاستجابة الاحتياطية
   - إضافة المراجع ذات الصلة في الاستجابة

4. **إضافة endpoint جديد `/knowledge/references`**:
   - يستقبل `study_type` ويُرجع قائمة المراجع المتاحة لهذا النوع
   - يُستخدم في الواجهة لعرض المراجع المتاحة

5. **إضافة endpoint جديد `/knowledge/study-types`**:
   - يُرجع قائمة أنواع الدراسات المدعومة مع وصفها

---

### Component 2: Backend API Enhancements (Node.js)

#### [MODIFY] [analyticsController.ts](file:///d:/Mostaql/oskar/backend/src/controllers/analyticsController.ts)

1. **تحديث `runAssistantChat()`** (سطر 439-503):
   - استخراج `study_type` من `req.body.study_context.study_metadata.studyType`
   - تمرير `study_type` كحقل مستقل إلى Python analytics
   - تحديث `queryKnowledgeEngineWithFallback()` ليمرر `study_type` كفلتر إضافي

2. **تحديث `buildKnowledgeQueryCandidates()`** (سطر 105-159):
   - إضافة `studyType` parameter
   - دمج نوع الدراسة في الـ contextual question
   - إضافة `study_type_filter` في الطلب المُرسل لـ Knowledge Engine

3. **تحديث `queryKnowledgeEngineWithFallback()`** (سطر 173-295):
   - إضافة `studyType` parameter 
   - تمرير `study_type` في body الطلب للـ Knowledge Engine `/api/v1/query`

4. **إضافة endpoints جديدة** للتحقق من أنواع الدراسات:
   - `GET /analytics/study-types` → يستدعي Python `/knowledge/study-types`
   - `GET /analytics/references/:studyType` → يستدعي Python `/knowledge/references`

#### [MODIFY] [analyticsRoutes.ts](file:///d:/Mostaql/oskar/backend/src/routes/analyticsRoutes.ts)

- إضافة route لـ `GET /study-types`
- إضافة route لـ `GET /references/:studyType`

---

### Component 3: Database Schema Update

#### [MODIFY] [db.ts](file:///d:/Mostaql/oskar/backend/src/db.ts)

- إضافة `CHECK` constraint على `study_type` في جدول `studies`:
  ```sql
  CHECK (study_type IN ('rct', 'prospective', 'retrospective', 'cross_sectional', 'in_vitro'))
  ```
- إضافة migration function لتحديث القيم الموجودة

> [!WARNING]
> سنقوم بإضافة migration يحول أي قيم موجودة إلى أقرب نوع مطابق. القيم غير المطابقة ستبقى كما هي مؤقتاً حتى مراجعتها يدوياً.

---

### Component 4: Frontend Changes

#### [MODIFY] [Studies.tsx](file:///d:/Mostaql/oskar/clinical-research-platform/src/pages/Studies.tsx)

1. **تحويل حقل `studyType`** من `<input type="text">` إلى `<select>` (سطر 1093-1102):
   ```tsx
   <select value={formState.studyType} onChange={...}>
     <option value="">اختر نوع الدراسة</option>
     <option value="rct">RCT (Randomized Controlled Trial)</option>
     <option value="prospective">Prospective Study</option>
     <option value="retrospective">Retrospective Study</option>
     <option value="cross_sectional">Cross-Sectional Study</option>
     <option value="in_vitro">In Vitro Study</option>
   </select>
   ```

2. **إضافة `STUDY_TYPES` constant** لاستخدامه في كل مكان يُعرض فيه نوع الدراسة:
   ```ts
   const STUDY_TYPES = {
     rct: 'RCT (Randomized Controlled Trial)',
     prospective: 'Prospective Study',
     retrospective: 'Retrospective Study',
     cross_sectional: 'Cross-Sectional Study',
     in_vitro: 'In Vitro Study',
   } as const;
   ```

#### [MODIFY] [AIChat.tsx](file:///d:/Mostaql/oskar/clinical-research-platform/src/pages/AIChat.tsx)

1. **تحديث `buildKnowledgeStudyContext()`** (سطر 415-438):
   - التأكد من إرسال `studyType` بشكل صريح مع الطلب

2. **تحديث `handleAssistant()`** (سطر 827-878):
   - إضافة `study_type` كحقل مستقل في body الطلب

3. **إضافة مؤشر بصري** يوضح:
   - نوع الدراسة المربوط بالجلسة الحالية
   - عدد المراجع المتاحة لهذا النوع
   - تنبيه إذا لم يتم اختيار دراسة (standalone mode)

4. **عرض شارة المكتبة المعرفية** بجانب اسم الدراسة تظهر النوع ومؤشر "مكتبة معرفية مربوطة"

#### [NEW] [studyTypes.ts](file:///d:/Mostaql/oskar/clinical-research-platform/src/lib/studyTypes.ts)

ملف مشترك يحتوي:
- `STUDY_TYPES` constant
- `STUDY_TYPE_LABELS` للعرض بالعربي والإنجليزي
- `getStudyTypeLabel(type)` helper function
- `STUDY_TYPE_ICONS` لأيقونات كل نوع
- `STUDY_TYPE_COLORS` لألوان مميزة لكل نوع

---

### Component 5: Knowledge Catalog Data Structure

#### [NEW] [knowledge_catalog.json](file:///d:/Mostaql/oskar/backend/python_analytics/app/knowledge_catalog.json)

ملف JSON منظم يحتوي الـ 126 مرجع مقسمة كالتالي:

| القسم | العدد |
|---|---|
| RCT References | ~35 مرجع |
| Prospective References | ~12 مرجع |
| Retrospective References | ~10 مرجع |
| Cross-Sectional References | ~10 مرجع |
| In Vitro References | ~18 مرجع |
| Shared (Ethics) | 3 مراجع |
| Shared (Data Management) | 6 مراجع (CDISC, CDASH, SDTM, ADaM, ODM, Define-XML) |
| Shared (Privacy) | 3 مراجع (GDPR, HIPAA, FDA 21 CFR) |
| Shared (Regulatory) | 3 مراجع (FDA, EMA, WHO) |
| Shared (Dental EBD) | 4 مراجع (ADA, FDI, IADR, Cochrane) |
| Shared (Outcomes) | 7 مراجع (COMET, COSMIN, PROMIS, OHIP, GOHAI, OIDP, MCID/MDC) |
| Shared (Diagnostics) | 4 مراجع |
| Shared (Radiology) | 2 مرجع |
| Shared (Calibration) | 4 مراجع |
| Shared (Medical Dictionaries) | 5 مراجع |
| **المجموع** | **~126 مرجع** |

كل مرجع يحمل:
```json
{
  "id": "CONSORT_2010",
  "title": "CONSORT 2010 Statement",
  "category": "reporting",
  "subcategory": "إعداد ونشر الدراسة",
  "study_types": ["rct"],
  "description_ar": "معيار إعداد تقارير التجارب العشوائية المضبوطة",
  "description_en": "Consolidated Standards of Reporting Trials",
  "is_extension": false,
  "parent_id": null
}
```

---

## Verification Plan

### Automated Tests

1. **Python unit tests** لـ `knowledge_catalog.py`:
   ```bash
   cd d:\Mostaql\oskar\backend\python_analytics
   python -m pytest tests/test_knowledge_catalog.py -v
   ```
   - التحقق من أن كل نوع دراسة يُرجع المراجع الصحيحة + المشتركة
   - التحقق من أن إجمالي المراجع = 126
   - التحقق من عدم تكرار IDs

2. **Python unit tests** لـ `prompt_library.py`:
   ```bash
   python -m pytest tests/test_prompt_library.py -v
   ```
   - التحقق من أن `build_system_prompt()` يُرجع prompt مختلف لكل نوع
   - التحقق من أن كل mode مغطى

3. **اختبار endpoints**:
   ```bash
   curl http://127.0.0.1:8001/knowledge/study-types
   curl http://127.0.0.1:8001/knowledge/references?study_type=rct
   ```

### Manual Verification

1. فتح صفحة إنشاء الدراسة والتأكد من ظهور القائمة المنسدلة بالأنواع الخمسة
2. إنشاء دراسة من نوع RCT → فتح AIChat → التأكد من أن:
   - الشارة تعرض "RCT"
   - الشات بوت يستخدم مراجع CONSORT/SPIRIT/ICH
   - لا يستحضر مراجع STROBE أو ISO
3. تكرار نفس الاختبار مع نوع In Vitro والتأكد من عزل ISO standards
4. اختبار الـ fallback بدون OpenAI key
