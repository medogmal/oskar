import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Image, LoaderCircle, LogOut, Plus, Printer, Save, Trash2 } from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type AssessmentTemplateField = {
  id: string;
  label: string;
  responseType: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
};

type TemplateVersion = {
  id: string;
  versionNumber: number;
  approvalStatus: 'approved' | 'pending_approval' | 'rejected';
  createdByName?: string;
  approvedByName?: string;
  changeNotes?: string;
  template: AssessmentTemplateField[];
  createdAt: string;
};

type OverviewResponse = {
  study: {
    id: string;
    title: string;
    studyType: string;
  };
  templateVersions: TemplateVersion[];
  approvedTemplate?: TemplateVersion | null;
};

function AssessmentFormBuilder() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { token, signOut } = useAuth();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [draft, setDraft] = useState<AssessmentTemplateField[]>([]);
  const [changeNotes, setChangeNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApprovingId, setIsApprovingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
    [],
  );

  const loadOverview = useCallback(async () => {
    if (!token || !id) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/studies/${id}/outcome-assessment/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load assessment form builder');
      }

      const data = (await response.json()) as OverviewResponse;
      setOverview(data);
      setDraft(data.approvedTemplate?.template ?? data.templateVersions[0]?.template ?? []);
    } catch {
      setError('تعذر تحميل استمارة الفحص الحالية.');
      setOverview(null);
    } finally {
      setIsLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const pendingVersions = useMemo(
    () => overview?.templateVersions.filter((item) => item.approvalStatus === 'pending_approval') ?? [],
    [overview],
  );

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const addField = () => {
    setDraft((current) => [
      ...current,
      {
        id: `field_${Date.now()}`,
        label: 'New field',
        responseType: 'text',
      },
    ]);
  };

  const updateField = <K extends keyof AssessmentTemplateField>(index: number, key: K, value: AssessmentTemplateField[K]) => {
    setDraft((current) => current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, [key]: value } : field)));
  };

  const removeField = (index: number) => {
    setDraft((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  };

  const saveTemplate = async () => {
    if (!token || !id || draft.length === 0) {
      setError('أضف عنصرًا واحدًا على الأقل داخل استمارة الفحص.');
      return;
    }

    try {
      setError('');
      setSuccessMessage('');
      setIsSaving(true);
      const response = await fetch(`${apiBaseUrl}/studies/${id}/outcome-assessment/template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          template: draft,
          changeNotes: changeNotes || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save assessment form');
      }

      setChangeNotes('');
      setSuccessMessage('تم حفظ ونشر استمارة الفحص بنجاح.');
      await loadOverview();
    } catch {
      setError('تعذر حفظ استمارة الفحص حالياً.');
    } finally {
      setIsSaving(false);
    }
  };

  const approveVersion = async (versionId: string) => {
    if (!token || !id) {
      return;
    }

    try {
      setError('');
      setSuccessMessage('');
      setIsApprovingId(versionId);
      const response = await fetch(`${apiBaseUrl}/studies/${id}/outcome-assessment/template/${versionId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to approve template version');
      }

      setSuccessMessage('تم اعتماد النسخة المقترحة من الاستمارة.');
      await loadOverview();
    } catch {
      setError('تعذر اعتماد النسخة المقترحة.');
    } finally {
      setIsApprovingId(null);
    }
  };

  return (
    <ResearchWorkspaceShell
      title="استعراض الاستمارة"
      subtitle="إنشاء واعتماد نسخة الباحث من استمارة الفحص ومراجعة النسخ المقترحة"
      currentStudyLabel={overview?.study.title}
      navItems={buildResearchWorkspaceNav(id).map((item) => ({
        ...item,
        active: item.key === 'form',
      }))}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate(id ? `/studies/${id}` : '/studies')}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            الرجوع للدراسة
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </>
      }
    >
      <div>
        {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {successMessage ? <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div> : null}

        {isLoading ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3 text-slate-600">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              <span>جاري تحميل استمارة الفحص...</span>
            </div>
          </div>
        ) : !overview ? null : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3.5 shadow-card">
              <div className="ml-2 flex items-center gap-2">
                <FileText className="h-5 w-5 text-teal-500" />
                <p className="text-sm font-black text-slate-700">استمارة الفحص السريري - معاينة الهوية البصرية والمواصفات</p>
              </div>
              <button type="button" onClick={() => void saveTemplate()} disabled={isSaving} className="rounded-xl bg-teal-600 px-5 py-2.5 text-xs font-extrabold text-white transition hover:bg-teal-700 disabled:opacity-70">
                <Save className="ml-2 inline h-3.5 w-3.5" />
                {isSaving ? 'جاري الحفظ...' : 'تحديث الاستمارة'}
              </button>
              <button type="button" className="rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-200">
                <Printer className="ml-2 inline h-3.5 w-3.5" />
                طباعة
              </button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr_0.7fr]">
              <div className="workspace-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">حقول الاستمارة الحالية</h2>
                    <p className="mt-1 text-sm text-slate-500">{overview.study.studyType}</p>
                  </div>
                  <button
                    type="button"
                    onClick={addField}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="h-4 w-4" />
                    إضافة حقل
                  </button>
                </div>

                <div className="mt-6 space-y-4">
                  {draft.map((field, index) => (
                    <div key={field.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(event) => updateField(index, 'label', event.target.value)}
                          className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="عنوان الحقل"
                        />
                        <select
                          value={field.responseType}
                          onChange={(event) => updateField(index, 'responseType', event.target.value as AssessmentTemplateField['responseType'])}
                          className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="text">Text</option>
                          <option value="numeric">Numeric</option>
                          <option value="choice">Choice</option>
                          <option value="boolean">Boolean</option>
                        </select>
                      </div>

                      {field.responseType === 'choice' ? (
                        <input
                          type="text"
                          value={(field.options ?? []).join(', ')}
                          onChange={(event) =>
                            updateField(
                              index,
                              'options',
                              event.target.value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            )
                          }
                          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="الاختيارات مفصولة بفاصلة"
                        />
                      ) : null}

                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeField(index)}
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <textarea
                  value={changeNotes}
                  onChange={(event) => setChangeNotes(event.target.value)}
                  rows={4}
                  className="mt-6 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ملاحظات عن سبب التعديل أو الهدف من النسخة الجديدة"
                />
              </div>

              <div className="prototype-a4-sheet p-10">
                <div className="relative">
                  <div className="flex items-center gap-6 border-b-2 border-slate-800 pb-5">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-2 border-teal-200 bg-teal-50 text-teal-600">
                      <Image className="h-10 w-10" />
                    </div>
                    <div className="flex-1 text-center">
                      <h3 className="text-lg font-black text-slate-800">استمارة الفحص السريري</h3>
                      <p className="mt-1 text-xs font-bold text-slate-500">{overview.study.title}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-400">{overview.study.studyType}</p>
                    </div>
                    <div className="space-y-1.5 text-[10px] font-extrabold text-slate-500">
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">Version: <b className="text-slate-700">{overview.approvedTemplate?.versionNumber ?? 'Draft'}</b></p>
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">Updated: <b className="text-slate-700">{formatDate((overview.approvedTemplate ?? overview.templateVersions[0])?.createdAt || new Date().toISOString())}</b></p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-slate-200 py-3.5 text-[11px] font-extrabold text-slate-600">
                    <p>الباحث الرئيسي: منصة الباحث</p>
                    <p>الدراسة: {overview.study.title}</p>
                    <p className="mr-auto rounded-full bg-teal-50 px-3 py-1 text-teal-700">النسخة الحالية للاستعراض</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 py-4 text-[11px] font-extrabold md:grid-cols-4">
                    <div className="prototype-field-box"><p className="mb-0.5 text-[9px] text-slate-400">كود العينة</p>PT-001</div>
                    <div className="prototype-field-box"><p className="mb-0.5 text-[9px] text-slate-400">كود التعمية</p>RND-4821</div>
                    <div className="prototype-field-box"><p className="mb-0.5 text-[9px] text-slate-400">العمر</p>21 سنة</div>
                    <div className="prototype-field-box"><p className="mb-0.5 text-[9px] text-slate-400">الجنس</p>أنثى</div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2">
                    {draft.slice(0, 6).map((field) => (
                      <div key={field.id} className="rounded-2xl border-2 border-slate-100 p-4">
                        <p className="mb-2 text-xs font-black text-slate-700">{field.label}</p>
                        {field.responseType === 'choice' ? (
                          <div className="prototype-field-box">
                            <select defaultValue={field.options?.[0] ?? ''}>
                              {(field.options ?? ['Option 1', 'Option 2']).map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                        ) : field.responseType === 'boolean' ? (
                          <div className="flex gap-2">
                            <button type="button" className="h-8 w-8 rounded-lg bg-green-500 text-xs text-white shadow">✓</button>
                            <button type="button" className="h-8 w-8 rounded-lg bg-slate-100 text-xs text-slate-400">✗</button>
                          </div>
                        ) : (
                          <div className="prototype-field-box">
                            <input placeholder={field.responseType === 'numeric' ? '0' : 'أدخل القيمة'} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="prototype-field-box mb-4">
                    <p className="mb-1 text-[9px] text-slate-400">ملاحظات نصية للزيارة الحالية</p>
                    <textarea rows={2} defaultValue="استجابة ممتازة للمعالجة، تحرك سريري واضح في الزيارة الحالية." />
                  </div>

                  <div className="mb-5">
                    <p className="mb-3 text-xs font-black text-slate-700">مرفقات الصور والأسطح</p>
                    <div className="grid grid-cols-4 gap-3">
                      {['صور داخل الفم', 'أشعة بانورامية', 'سيفالومتريك', 'صور خارجية'].map((label, index) => (
                        <div key={label} className="overflow-hidden rounded-xl border border-slate-200">
                          <div className={`flex h-20 items-center justify-center text-white/80 ${index === 0 ? 'bg-gradient-to-br from-rose-200 via-rose-300 to-rose-400' : index === 1 ? 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900' : index === 2 ? 'bg-gradient-to-br from-indigo-800 via-indigo-900 to-slate-900' : 'bg-gradient-to-br from-sky-200 via-sky-300 to-sky-400'}`}>
                            <Image className="h-7 w-7" />
                          </div>
                          <p className="bg-slate-50 py-1.5 text-center text-[9px] font-extrabold text-slate-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t-2 border-slate-800 pt-4 text-[10px] font-bold text-slate-400">
                    صفحة 1 من 2 - وثيقة رسمية مولدة عبر المنصة
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="workspace-card p-6">
                  <h2 className="text-xl font-bold text-slate-900">النسخة المعتمدة</h2>
                  {overview.approvedTemplate ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="font-semibold text-emerald-900">Version {overview.approvedTemplate.versionNumber}</p>
                      <p className="mt-1 text-sm text-emerald-800">{overview.approvedTemplate.approvedByName || overview.approvedTemplate.createdByName || 'System'}</p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">لا توجد نسخة معتمدة بعد.</div>
                  )}
                </div>

                <div className="workspace-card p-6">
                  <h2 className="text-xl font-bold text-slate-900">النسخ المقترحة من المقيمين</h2>
                  {pendingVersions.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">لا توجد نسخ معلقة لاعتمادها حالياً.</div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {pendingVersions.map((version) => (
                        <div key={version.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <p className="font-semibold text-amber-900">Version {version.versionNumber}</p>
                          <p className="mt-1 text-xs text-amber-800">{version.createdByName || 'User'} • {formatDate(version.createdAt)}</p>
                          <button
                            type="button"
                            onClick={() => void approveVersion(version.id)}
                            disabled={isApprovingId === version.id}
                            className="mt-4 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-70"
                          >
                            {isApprovingId === version.id ? 'جاري الاعتماد...' : 'اعتماد هذه النسخة'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="workspace-card p-6">
                  <h2 className="text-xl font-bold text-slate-900">سجل النسخ</h2>
                  <div className="mt-4 space-y-3">
                    {overview.templateVersions.map((version) => (
                      <div key={version.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">Version {version.versionNumber}</p>
                            <p className="mt-1 text-xs text-slate-500">{version.createdByName || 'User'} • {formatDate(version.createdAt)}</p>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{version.approvalStatus}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ResearchWorkspaceShell>
  );
}

export default AssessmentFormBuilder;
