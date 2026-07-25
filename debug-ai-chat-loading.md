# Debug Session: ai-chat-loading [OPEN]

## Symptom
- صفحة `AIChat` تعمل loading ولا تفتح بشكل طبيعي.

## Expected
- تفتح صفحة المساعد الذكي مباشرة للمستخدم المصرح له، وتظهر الواجهة بدل التعليق على التحميل.

## Initial Hypotheses
1. يوجد خطأ runtime داخل `AIChat` نفسها يمنع اكتمال render بعد تحميل الـ bundle.
2. يوجد فشل في `ProtectedRoute` أو `AuthProvider` يجعل الصفحة تظل في حالة تحقق auth بدون حسم.
3. يوجد request داخل `AIChat` مثل `analytics/health` أو `studies` يعلق أو يرمي exception غير ظاهر ويمنع فتح الصفحة.
4. يوجد خطأ lazy loading أو chunk loading لملف `AIChat` الكبير يمنع الصفحة من الاكتمال.
5. يوجد mismatch في الترجمة أو البيانات المرجعية المستخدمة أثناء أول render يسبب crash صامت في المتصفح.

## Evidence Plan
- فحص مسار التوجيه والـ auth والـ lazy loading.
- تشغيل الواجهة أو معاينة الإنتاج وجمع أي runtime error ظاهر.
- التحقق من network/API health الخاصة بالصفحة.
- إضافة instrumentation فقط إذا احتجنا دليلًا أدق.

## Status
- Pending evidence collection.
