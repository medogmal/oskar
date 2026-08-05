import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  FileQuestion,
  FileText,
  Home,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import StlViewer from '../components/StlViewer';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type AssessmentTemplateField = {
  id: string;
  label: string;
  responseType: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
  section?: string;
  required?: boolean;
  note?: string;
};

type WorkspaceData = {
  request: {
    id: string;
    studyId: string;
    studyTitle: string;
    studyType: string;
    requestStatus: string;
    assessmentType: string;
    deadlineAt?: string;
    optionalMessage?: string;
  };
  samples: Array<{
    id: string;
    subjectId: string;
    visitNumber: string;
    sampleStatus: string;
    assets: Array<{
      id: string;
      fileId: string;
      originalName: string;
      assetType: string;
    }>;
  }>;
  entries: Array<{
    id: string;
    sampleId: string;
    response: Record<string, unknown>;
    status: string;
    assessorComments?: string;
  }>;
  approvedTemplate?: {
    id: string;
    versionNumber: number;
    template: AssessmentTemplateField[];
  } | null;
  templateVersions: Array<{
    id: string;
    versionNumber: number;
    approvalStatus: string;
    changeNotes?: string;
    template: AssessmentTemplateField[];
  }>;
  notes: Array<{
    id: string;
    authorName?: string;
    message: string;
    createdAt: string;
  }>;
};

function OutcomeAssessmentWorkspace() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const { user, signOut, token } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [draftResponse, setDraftResponse] = useState<Record<string, unknown>>({});
  const [draftComments, setDraftComments] = useState('');
  const [templateDraft, setTemplateDraft] = useState<AssessmentTemplateField[]>([]);
  const [templateChangeNotes, setTemplateChangeNotes] = useState('');
  const [noteMessage, setNoteMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [isSubmittingEntry, setIsSubmittingEntry] = useState(false);
  const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [error, setError] = useState<{
    type: 'permission' | 'not_found' | 'no_template' | 'network' | 'unknown';
    message: string;
    detail?: string;
    canRetry: boolean;
  } | null>(null);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const classifyHttpError = (response: Response, fallbackMessage: string) => {
    const status = response.status;
    if (status === 401 || status === 403) {
      return {
        type: 'permission' as const,
        message: 'ليس لديك صلاحية الوصول إلى مساحة الفحص هذه',
        detail: status === 401 ? 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.' : 'تم رفض الوصول. تحقق من أنك قمت بتسجيل الدخول بالحساب الصحيح كمقيم سريري.',
        canRetry: status === 403,
      };
    }
    if (status === 404) {
      return {
        type: 'not_found' as const,
        message: 'لم يتم العثور على طلب الفحص أو الدراسة',
        detail: 'قد يكون طلب الفحص قد تم حذفه أو الرابط غير صحيح. تواصل مع فريق البحث للحصول على رابط صالح.',
        canRetry: false,
      };
    }
    if (status === 422 || status === 409) {
      return {
        type: 'no_template' as const,
        message: 'نموذج الفحص غير متوفر حالياً',
        detail: 'لم يتم تعريف نموذج التقييم لهذه الدراسة بعد. انتظر من المشرف تجهيز النموذج أو تواصل مع فريق البحث.',
        canRetry: true,
      };
    }
    if (status >= 500) {
      return {
        type: 'network' as const,
        message: 'خطأ في الخادم أثناء تحميل مساحة الفحص',
        detail: `الخادم أعاد رمز الخطأ ${status}. يحب إعادة المحاولة بعد قليل.`,
        canRetry: true,
      };
    }
    return {
      type: 'unknown' as const,
      message: fallbackMessage,
      detail: `رمز الاستجابة: ${status}`,
      canRetry: true,
    };
  };

  const loadWorkspace = useCallback(async () => {
    if (!token || !requestId) {
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/workspace`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw Object.assign(new Error('HTTPError'), { status: response.status, response });
      }

      const data = (await response.json()) as WorkspaceData;
      setWorkspace(data);
      setTemplateDraft(data.approvedTemplate?.template ?? []);

      if (!data.approvedTemplate || data.approvedTemplate.template.length === 0) {
        setError({
          type: 'no_template',
          message: 'لا يوجد نموذج فحص معتمد للدراسة حالياً',
          detail: 'لم يتم اعتماد نموذج التقييم النهائي. يمكنك اقتراح نموذج بديل أدناه أو التواصل مع فريق البحث لتفعيل النموذج.',
          canRetry: true,
        });
      }

      if (!selectedSampleId && data.samples[0]) {
        setSelectedSampleId(data.samples[0].id);
      }
    } catch (loadError) {
      setWorkspace(null);
      if (loadError instanceof Error && loadError.message === 'HTTPError' && 'status' in loadError && 'response' in loadError) {
        const status = Number(loadError.status);
        const fallback = 'تعذر تحميل مساحة عمل المقيم السريري.';
        const fakeResponse = { status } as Response;
        setError(classifyHttpError(fakeResponse, fallback));
      } else if (loadError instanceof TypeError && /failed to fetch|networkerror/i.test(loadError.message)) {
        setError({
          type: 'network',
          message: 'تعذر الاتصال بالخادم',
          detail: 'تحقق من اتصال الإنترنت الخاص بك أو إعادة المحاولة بعد قليل.',
          canRetry: true,
        });
      } else {
        setError({
          type: 'unknown',
          message: 'تعذر تحميل مساحة عمل المقيم السريري.',
          detail: loadError instanceof Error ? loadError.message : 'خطأ غير معروف',
          canRetry: true,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [requestId, selectedSampleId, token]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedSample = useMemo(
    () => workspace?.samples.find((sample) => sample.id === selectedSampleId) ?? null,
    [selectedSampleId, workspace?.samples],
  );

  const selectedEntry = useMemo(
    () => workspace?.entries.find((entry) => entry.sampleId === selectedSampleId) ?? null,
    [selectedSampleId, workspace?.entries],
  );

  useEffect(() => {
    setDraftResponse(selectedEntry?.response ?? {});
    setDraftComments(selectedEntry?.assessorComments ?? '');
  }, [selectedEntry]);

  const setFieldValue = (fieldId: string, value: unknown) => {
    setDraftResponse((current) => ({
      ...current,
      [fieldId]: value,
    }));
  };

  const persistEntry = async (submit: boolean) => {
    if (!token || !selectedEntry) {
      return;
    }

    try {
      setError(null);
      if (submit) {
        setIsSubmittingEntry(true);
      } else {
        setIsSavingEntry(true);
      }

      const response = await fetch(
        `${apiBaseUrl}/studies/outcome-assessment/assessor/entries/${selectedEntry.id}/${submit ? 'submit' : 'save'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            response: draftResponse,
            assessorComments: draftComments,
          }),
        },
      );

      if (!response.ok) {
        throw Object.assign(new Error('HTTPError'), { status: response.status });
      }

      await loadWorkspace();
    } catch (saveError) {
      const fallback = submit ? 'تعذر إرسال التقييم.' : 'تعذر حفظ مسودة التقييم.';
      if (saveError instanceof Error && saveError.message === 'HTTPError' && 'status' in saveError) {
        const fakeResponse = { status: Number(saveError.status) } as Response;
        setError(classifyHttpError(fakeResponse, fallback));
      } else {
        setError({
          type: 'unknown',
          message: fallback,
          detail: saveError instanceof Error ? saveError.message : 'خطأ غير معروف',
          canRetry: true,
        });
      }
    } finally {
      setIsSavingEntry(false);
      setIsSubmittingEntry(false);
    }
  };

  const addTemplateField = () => {
    setTemplateDraft((current) => [
      ...current,
      {
        id: `field_${Date.now()}`,
        label: 'New field',
        responseType: 'text',
      },
    ]);
  };

  const updateTemplateField = <K extends keyof AssessmentTemplateField>(
    index: number,
    key: K,
    value: AssessmentTemplateField[K],
  ) => {
    setTemplateDraft((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, [key]: value } : field)),
    );
  };

  const removeTemplateField = (index: number) => {
    setTemplateDraft((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  };

  const submitTemplateUpdate = async () => {
    if (!token || !requestId) {
      return;
    }

    try {
      setError(null);
      setIsSubmittingTemplate(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          template: templateDraft,
          changeNotes: templateChangeNotes,
        }),
      });

      if (!response.ok) {
        throw Object.assign(new Error('HTTPError'), { status: response.status });
      }

      setTemplateChangeNotes('');
      await loadWorkspace();
    } catch (templateError) {
      const fallback = 'تعذر إرسال تعديلات النموذج للموافقة.';
      if (templateError instanceof Error && templateError.message === 'HTTPError' && 'status' in templateError) {
        const fakeResponse = { status: Number(templateError.status) } as Response;
        setError(classifyHttpError(fakeResponse, fallback));
      } else {
        setError({
          type: 'unknown',
          message: fallback,
          detail: templateError instanceof Error ? templateError.message : 'خطأ غير معروف',
          canRetry: true,
        });
      }
    } finally {
      setIsSubmittingTemplate(false);
    }
  };

  const sendNote = async () => {
    if (!token || !requestId || !noteMessage.trim()) {
      return;
    }

    try {
      setError(null);
      setIsSubmittingNote(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: noteMessage,
          sampleId: selectedSampleId || undefined,
        }),
      });

      if (!response.ok) {
        throw Object.assign(new Error('HTTPError'), { status: response.status });
      }

      setNoteMessage('');
      await loadWorkspace();
    } catch (noteError) {
      const fallback = 'تعذر إرسال الملاحظة.';
      if (noteError instanceof Error && noteError.message === 'HTTPError' && 'status' in noteError) {
        const fakeResponse = { status: Number(noteError.status) } as Response;
        setError(classifyHttpError(fakeResponse, fallback));
      } else {
        setError({
          type: 'unknown',
          message: fallback,
          detail: noteError instanceof Error ? noteError.message : 'خطأ غير معروف',
          canRetry: true,
        });
      }
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const downloadFile = async (fileId: string, fileName: string) => {
    if (!token || !workspace) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`${apiBaseUrl}/studies/${workspace.request.studyId}/files/${fileId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw Object.assign(new Error('HTTPError'), { status: response.status });
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      const fallback = 'تعذر تحميل ملف العينة المحجوب.';
      if (downloadError instanceof Error && downloadError.message === 'HTTPError' && 'status' in downloadError) {
        const fakeResponse = { status: Number(downloadError.status) } as Response;
        setError(classifyHttpError(fakeResponse, fallback));
      } else {
        setError({
          type: 'unknown',
          message: fallback,
          detail: downloadError instanceof Error ? downloadError.message : 'خطأ غير معروف',
          canRetry: true,
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              ClinResearch AI
            </h2>
            <p className="mt-2 text-sm text-slate-400">Outcome assessor workspace</p>
          </div>

          <div className="p-6">
            <nav className="space-y-2">
              <Link to="/clinical-evaluator-dashboard" className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
                <Home className="h-5 w-5" />
                <span>Dashboard</span>
              </Link>
              <Link to="/clinical-evaluator-dashboard" className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white">
                <FileText className="h-5 w-5" />
                <span>Assessment Study</span>
              </Link>
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">Outcome Assessor</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {workspace?.request.studyTitle || 'Assessment Workspace'}
              </h1>
              <p className="mt-2 text-slate-600">{workspace?.request.assessmentType || 'Independent blinded review'}</p>
              <p className="mt-2 text-sm text-slate-500">{user?.fullName}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>

          {error ? (
            <div className={`mb-6 rounded-2xl border p-5 shadow-sm ${
              error.type === 'permission' ? 'border-amber-200 bg-amber-50' :
              error.type === 'not_found' ? 'border-slate-200 bg-slate-50' :
              error.type === 'no_template' ? 'border-sky-200 bg-sky-50' :
              error.type === 'network' ? 'border-orange-200 bg-orange-50' :
              'border-rose-200 bg-rose-50'
            }`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    error.type === 'permission' ? 'bg-amber-100 text-amber-700' :
                    error.type === 'not_found' ? 'bg-slate-100 text-slate-700' :
                    error.type === 'no_template' ? 'bg-sky-100 text-sky-700' :
                    error.type === 'network' ? 'bg-orange-100 text-orange-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {error.type === 'permission' ? <ShieldAlert className="h-5 w-5" /> :
                     error.type === 'not_found' ? <FileQuestion className="h-5 w-5" /> :
                     error.type === 'no_template' ? <FileText className="h-5 w-5" /> :
                     error.type === 'network' ? <Wifi className="h-5 w-5" /> :
                     <AlertCircle className="h-5 w-5" />}
                  </div>
                  <div>
                    <h3 className={`text-sm font-black ${
                      error.type === 'permission' ? 'text-amber-900' :
                      error.type === 'not_found' ? 'text-slate-900' :
                      error.type === 'no_template' ? 'text-sky-900' :
                      error.type === 'network' ? 'text-orange-900' :
                      'text-rose-900'
                    }`}>{error.message}</h3>
                    {error.detail ? (
                      <p className={`mt-1 text-xs ${
                        error.type === 'permission' ? 'text-amber-700' :
                        error.type === 'not_found' ? 'text-slate-600' :
                        error.type === 'no_template' ? 'text-sky-700' :
                        error.type === 'network' ? 'text-orange-700' :
                        'text-rose-700'
                      }`}>{error.detail}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {error.type === 'permission' ? (
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>تسجيل الدخول بحساب آخر</span>
                    </button>
                  ) : null}
                  {error.type === 'not_found' ? (
                    <Link
                      to="/clinical-evaluator-dashboard"
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span>العودة إلى لوحة المقيم</span>
                    </Link>
                  ) : null}
                  {error.canRetry ? (
                    <button
                      type="button"
                      onClick={() => void loadWorkspace()}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>إعادة المحاولة</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3 text-slate-600">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>جارٍ تحميل مساحة الفحص...</span>
              </div>
            </div>
          ) : !workspace ? (
            <div className="rounded-2xl bg-white p-10 shadow-sm ring-1 ring-slate-200">
              <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
                  <FileQuestion className="h-8 w-8" />
                </div>
                <h2 className="mt-6 text-xl font-black text-slate-900">مساحة الفحص غير متاحة</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  لم يتم تحميل بيانات طلب الفحص الحالي. قد يكون السبب نهاية صلاحية الجلسة، أو عدم وجود صلاحيات، أو حذف الطلب من قِبل فريق البحث.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => void loadWorkspace()}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>تحديث الصفحة</span>
                  </button>
                  <Link
                    to="/clinical-evaluator-dashboard"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Home className="h-4 w-4" />
                    <span>العودة إلى لوحة التحكم</span>
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-700" />
                  <h2 className="text-lg font-bold text-slate-900">Study Snapshot</h2>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Study type</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.studyType}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Request status</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.requestStatus}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Deadline</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.deadlineAt || 'Not set'}</p>
                  </div>
                </div>
                {workspace.request.optionalMessage ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    {workspace.request.optionalMessage}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Samples</h2>
                  <div className="mt-4 space-y-3">
                    {workspace.samples.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() => setSelectedSampleId(sample.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selectedSampleId === sample.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <p className="font-semibold text-slate-900">{sample.subjectId}</p>
                        <p className="mt-1 text-sm text-slate-500">Visit {sample.visitNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">{sample.sampleStatus}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">Blinded Assets</h2>
                    {!selectedSample ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        Select a sample to start reviewing assets.
                      </div>
                    ) : selectedSample.assets.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        No blinded assets linked to this sample yet.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {selectedSample.assets.map((asset) => (
                          <div key={asset.id} className="rounded-2xl border border-slate-200 p-4">
                            <p className="font-semibold text-slate-900">{asset.assetType}</p>
                            <p className="mt-1 text-sm text-slate-500">{asset.originalName}</p>
                            {asset.assetType === 'stl' ? (
                              <div className="mt-4">
                                <StlViewer
                                  studyId={workspace.request.studyId}
                                  fileId={asset.fileId}
                                  fileName={asset.originalName}
                                  token={token!}
                                />
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void downloadFile(asset.fileId, asset.originalName)}
                              className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">Assessment Form</h2>
                    <div className="mt-4 space-y-4">
                      {(workspace.approvedTemplate?.template ?? []).map((field) => (
                        <div key={field.id}>
                          {field.section ? <p className="mb-1 text-xs font-bold uppercase text-indigo-600">{field.section}</p> : null}
                          <label className="mb-1 block text-sm font-medium text-slate-700">{field.label}</label>
                          {field.responseType === 'choice' ? (
                            <select
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value)}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Select</option>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : field.responseType === 'boolean' ? (
                            <select
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value === 'true')}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Select</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : field.responseType === 'numeric' ? (
                            <input
                              type="number"
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, Number(event.target.value))}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <textarea
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value)}
                              rows={3}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      ))}

                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Comments</label>
                        <textarea
                          value={draftComments}
                          onChange={(event) => setDraftComments(event.target.value)}
                          rows={4}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void persistEntry(false)}
                          disabled={!selectedEntry || isSavingEntry}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                        >
                          <Save className="h-4 w-4" />
                          {isSavingEntry ? 'Saving...' : 'Save Draft'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void persistEntry(true)}
                          disabled={!selectedEntry || isSubmittingEntry}
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                        >
                          <Send className="h-4 w-4" />
                          {isSubmittingEntry ? 'Submitting...' : 'Submit Assessment'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Template Adjustment</h2>
                  <p className="mt-1 text-sm text-slate-500">Propose changes for researcher/supervisor approval with version history.</p>

                  <div className="mt-4 space-y-4">
                    {templateDraft.map((field, index) => (
                      <div key={field.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            value={field.label}
                            onChange={(event) => updateTemplateField(index, 'label', event.target.value)}
                            className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Field label"
                          />
                          <select
                            value={field.responseType}
                            onChange={(event) =>
                              updateTemplateField(index, 'responseType', event.target.value as AssessmentTemplateField['responseType'])
                            }
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
                              updateTemplateField(
                                index,
                                'options',
                                event.target.value
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              )
                            }
                            className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Options separated by commas"
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeTemplateField(index)}
                          className="mt-3 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Remove field
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addTemplateField}
                    className="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Add Field
                  </button>

                  <textarea
                    value={templateChangeNotes}
                    onChange={(event) => setTemplateChangeNotes(event.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe why the assessment form needs to be adjusted"
                  />

                  <button
                    type="button"
                    onClick={() => void submitTemplateUpdate()}
                    disabled={isSubmittingTemplate}
                    className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    {isSubmittingTemplate ? 'Submitting...' : 'Submit Template Changes'}
                  </button>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Notes Thread</h2>
                  <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                    {workspace.notes.map((note) => (
                      <div key={note.id} className="rounded-2xl bg-slate-50 p-4">
                        <p className="font-semibold text-slate-900">{note.authorName || 'User'}</p>
                        <p className="mt-1 text-sm text-slate-600">{note.message}</p>
                        <p className="mt-2 text-xs text-slate-500">{note.createdAt}</p>
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={noteMessage}
                    onChange={(event) => setNoteMessage(event.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Request re-upload, report missing data, or ask a scientific question"
                  />
                  <button
                    type="button"
                    onClick={() => void sendNote()}
                    disabled={isSubmittingNote}
                    className="mt-4 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                  >
                    {isSubmittingNote ? 'Sending...' : 'Send Note'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default OutcomeAssessmentWorkspace;
