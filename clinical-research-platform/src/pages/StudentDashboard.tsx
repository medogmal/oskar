import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderKanban,
  LoaderCircle,
  LogOut,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type Study = {
  id: string;
  title: string;
  description?: string;
  studyType: string;
  workflowType: 'supervised' | 'migration';
  status: 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  targetSampleSize: number;
  enrolledPatients: number;
  hasRandomization?: boolean;
  hasBlinding?: boolean;
  reviewDecision?: 'approved' | 'changes_requested' | 'rejected';
  requiresClinicalEvaluation: boolean;
  clinicalEvaluationDecision?: 'pending' | 'accepted' | 'needs_revision' | 'not_recommended';
  supervisorName?: string;
  assistantSupervisorName?: string;
  assignedClinicalEvaluatorName?: string;
  updatedAt: string;
};

type DashboardSample = {
  id: string;
  inclusionEligible: boolean;
  allocatedGroup?: string;
  maskedGroupCode?: string;
  sampleStatus: 'pending' | 'in_progress' | 'submitted' | 'reopened';
};

type DashboardOverview = {
  study: Study;
  samples: DashboardSample[];
  approvedTemplate?: {
    id: string;
    versionNumber: number;
  } | null;
  templateVersions: Array<{
    id: string;
    approvalStatus: 'approved' | 'pending_approval' | 'rejected';
  }>;
};

const getReadableStudyStatus = (status: Study['status']) => {
  switch (status) {
    case 'draft':
      return 'مسودة';
    case 'pending':
      return 'بانتظار المراجعة';
    case 'approved':
      return 'معتمدة';
    case 'active':
      return 'نشطة';
    case 'completed':
      return 'مكتملة';
    case 'cancelled':
      return 'ملغية';
    default:
      return status;
  }
};

function StudentDashboard() {
  const navigate = useNavigate();
  const { user, signOut, token } = useAuth();
  const [studies, setStudies] = useState<Study[]>([]);
  const [focusStudyId, setFocusStudyId] = useState('');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const formatNumber = useCallback((value: number) => new Intl.NumberFormat('ar-EG').format(value), []);

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
    [],
  );

  const fetchStudies = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load studies');
      }

      const data = (await response.json()) as Study[];
      setStudies(data);
      setFocusStudyId((current) => {
        if (current && data.some((study) => study.id === current)) {
          return current;
        }
        return data.find((study) => ['active', 'approved', 'pending'].includes(study.status))?.id ?? data[0]?.id ?? '';
      });
    } catch {
      setError('تعذر تحميل الدراسات الحالية.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const fetchOverview = useCallback(async () => {
    if (!token || !focusStudyId) {
      setOverview(null);
      return;
    }

    try {
      setIsLoadingOverview(true);
      const response = await fetch(`${apiBaseUrl}/studies/${focusStudyId}/outcome-assessment/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load study overview');
      }

      setOverview((await response.json()) as DashboardOverview);
    } catch {
      setOverview(null);
    } finally {
      setIsLoadingOverview(false);
    }
  }, [focusStudyId, token]);

  useEffect(() => {
    void fetchStudies();
  }, [fetchStudies]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const activeStudies = studies.filter((study) => ['approved', 'active'].includes(study.status)).length;
  const pendingStudies = studies.filter((study) => study.status === 'pending').length;
  const patientsEnrolled = studies.reduce((total, study) => total + study.enrolledPatients, 0);
  const flaggedStudies = studies.filter(
    (study) =>
      study.reviewDecision === 'changes_requested' ||
      study.clinicalEvaluationDecision === 'needs_revision' ||
      study.clinicalEvaluationDecision === 'not_recommended',
  );

  const focusStudy = useMemo(() => studies.find((study) => study.id === focusStudyId) ?? null, [focusStudyId, studies]);

  const sampleMetrics = useMemo(() => {
    const samples = overview?.samples ?? [];
    return {
      total: samples.length,
      active: samples.filter((sample) => ['pending', 'in_progress', 'reopened'].includes(sample.sampleStatus)).length,
      completed: samples.filter((sample) => sample.sampleStatus === 'submitted').length,
      excluded: samples.filter((sample) => !sample.inclusionEligible).length,
      allocated: samples.filter((sample) => Boolean(sample.allocatedGroup)).length,
      blinded: samples.filter((sample) => Boolean(sample.maskedGroupCode)).length,
    };
  }, [overview?.samples]);

  const methodologyProgress = useMemo(
    () => [
      {
        title: 'التحقق والحفظ',
        done: Boolean(focusStudy?.status && focusStudy.status !== 'draft'),
        helper: 'تسجيل الدراسة واعتماد بياناتها الأساسية',
      },
      {
        title: 'إعدادات التعمية',
        done: Boolean(focusStudy?.hasBlinding),
        helper: 'ضبط أطراف التعمية ونطاقها',
      },
      {
        title: 'إعدادات العشوائية',
        done: Boolean(focusStudy?.hasRandomization),
        helper: 'ضبط آلية التوزيع والمجموعات',
      },
      {
        title: 'استمارة الفحص',
        done: Boolean(overview?.approvedTemplate),
        helper: 'نشر نسخة معتمدة من الاستمارة',
      },
    ],
    [focusStudy?.hasBlinding, focusStudy?.hasRandomization, focusStudy?.status, overview?.approvedTemplate],
  );

  const subscriptionLabel = user?.subscription?.plan ?? (user?.trialEndsAt ? 'تجربة مجانية' : 'بدون خطة نشطة');
  const subscriptionStatus = user?.subscription?.status ?? (user?.trialEndsAt ? 'trial' : 'inactive');

  const quickStudyRoutes = {
    overview: focusStudyId ? `/studies/${focusStudyId}?tab=overview` : '/studies',
    patients: focusStudyId ? `/studies/${focusStudyId}?tab=patients` : '/studies',
    files: focusStudyId ? `/studies/${focusStudyId}?tab=files` : '/studies',
    form: focusStudyId ? `/studies/${focusStudyId}/assessment-form` : '/studies',
    analysis: focusStudyId ? `/ai-chat?studyId=${focusStudyId}` : '/ai-chat',
  };

  return (
    <ResearchWorkspaceShell
      title={`مرحبًا ${user?.fullName || 'الباحث'}`}
      subtitle="مساحة عمل موحدة لإدارة الدراسة، المنهجية، العيّنات، استمارة الفحص، والتحليل الإحصائي."
      currentStudyLabel={focusStudy ? `${focusStudy.title} • ${getReadableStudyStatus(focusStudy.status)}` : subscriptionLabel}
      navItems={buildResearchWorkspaceNav(focusStudyId || undefined).map((item) => ({
        ...item,
        active: item.key === 'dashboard',
      }))}
      actions={
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" />
          تسجيل الخروج
        </button>
      }
    >
      {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      {flaggedStudies.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
            <div className="flex-1">
              <h2 className="font-semibold text-rose-800">تنبيهات تحتاج متابعة</h2>
              <p className="mt-1 text-sm text-rose-700">
                لديك {formatNumber(flaggedStudies.length)} دراسة تحتوي على ملاحظات مراجعة أو تقييم سريري يحتاج انتباهك.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3 text-slate-600">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>جاري تحميل لوحة الباحث...</span>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl bg-gradient-to-r from-teal-950 via-teal-900 to-cyan-900 p-6 text-white shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm text-teal-100">مسار الدراسة الحالي</p>
                <h2 className="mt-2 text-3xl font-bold">{focusStudy?.title || 'ابدأ أول دراسة جديدة'}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-teal-50/90">
                  {focusStudy
                    ? `نوع الدراسة: ${focusStudy.studyType} • الحالة: ${getReadableStudyStatus(focusStudy.status)} • آخر تحديث: ${formatDate(
                        focusStudy.updatedAt,
                      )}`
                    : 'ابدأ برفع المقترح البحثي أو استيراد دراسة قائمة، ثم أكمل المنهجية والعشوائية والتعمية قبل إدخال العينات.'}
                </p>
                <p className="mt-2 text-sm text-teal-100/80">
                  {user?.email || ''}
                  {user?.university ? ` • ${user.university}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to="/studies?create=1&workflow=supervised" className="rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-400">
                  تأسيس دراسة جديدة
                </Link>
                <Link to="/studies?create=1&workflow=migration" className="rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15">
                  استيراد دراسة قائمة
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'الدراسات النشطة', value: formatNumber(activeStudies), helper: 'الدراسات المعتمدة أو الجارية', icon: FileText, tone: 'bg-blue-100 text-blue-600' },
              { label: 'إجمالي المرضى', value: formatNumber(patientsEnrolled), helper: 'إجمالي العينات المسجلة عبر الدراسات', icon: Users, tone: 'bg-teal-100 text-teal-600' },
              { label: 'قيد المراجعة', value: formatNumber(pendingStudies), helper: 'دراسات بانتظار اعتماد أو مراجعة', icon: ClipboardList, tone: 'bg-orange-100 text-orange-600' },
              { label: 'ملاحظات مفتوحة', value: formatNumber(flaggedStudies.length), helper: 'تنبيهات أو اعتراضات تحتاج إجراء', icon: ShieldAlert, tone: 'bg-rose-100 text-rose-600' },
            ].map(({ label, value, helper, icon: Icon, tone }) => (
              <div key={label} className="workspace-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
                <p className="mt-2 text-xs text-slate-500">{helper}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
            <section className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="prototype-pick-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-500">(Current Existing Study)</p>
                      <h3 className="mt-2 text-xl font-bold text-slate-900">إنشاء دراسة قائمة</h3>
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        <li>استيراد البروتوكول واستمارة الفحص الورقية الحالية</li>
                        <li>تشغيل OCR والمراجعة البشرية على الحقول</li>
                        <li>استئناف الدراسة من حيث توقفت داخل المنصة</li>
                      </ul>
                    </div>
                    <FolderKanban className="h-8 w-8 text-slate-400" />
                  </div>
                  <Link to="/studies?create=1&workflow=migration" className="mt-5 block rounded-xl bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700">
                    استيراد دراسة قائمة
                  </Link>
                </div>

                <div className="prototype-pick-card selected">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-teal-600">(New Study)</p>
                      <h3 className="mt-2 text-xl font-bold text-slate-900">إنشاء دراسة جديدة</h3>
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        <li>رفع المقترح البحثي وتحويله إلى حقول ذكية</li>
                        <li>ضبط العشوائية والتعمية والمنهجية</li>
                        <li>توليد استمارة الفحص والبدء في إدخال العينات</li>
                      </ul>
                    </div>
                    <Sparkles className="h-8 w-8 text-teal-500" />
                  </div>
                  <Link to="/studies?create=1&workflow=supervised" className="mt-5 block rounded-xl bg-teal-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-teal-700">
                    تأسيس دراسة جديدة
                  </Link>
                </div>
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">اختيار الدراسة النشطة</h2>
                    <p className="mt-1 text-sm text-slate-500">اختر الدراسة التي تريد عرض مؤشرات العمل الحالية الخاصة بها.</p>
                  </div>
                  <select
                    value={focusStudyId}
                    onChange={(event) => setFocusStudyId(event.target.value)}
                    className="min-w-[280px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {studies.length === 0 ? <option value="">لا توجد دراسات بعد</option> : null}
                    {studies.map((study) => (
                      <option key={study.id} value={study.id}>
                        {study.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {methodologyProgress.map((item, index) => (
                    <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {index + 1}. {item.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{item.helper}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {item.done ? 'مكتمل' : 'قيد الإعداد'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">حالات العينات والمتابعة</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {focusStudy ? `مؤشرات حية مستمدة من دراسة: ${focusStudy.title}` : 'اختر دراسة لعرض حالة العينات.'}
                    </p>
                  </div>
                  {isLoadingOverview ? <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" /> : <Activity className="h-5 w-5 text-slate-400" />}
                </div>

                <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
                  {[
                    { label: 'نشطة', value: sampleMetrics.active, tone: 'bg-orange-50 text-orange-700 ring-orange-200' },
                    { label: 'مكتملة', value: sampleMetrics.completed, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
                    { label: 'مستبعدة', value: sampleMetrics.excluded, tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
                    { label: 'مخصصة', value: sampleMetrics.allocated, tone: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
                    { label: 'معماة', value: sampleMetrics.blinded, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
                    { label: 'إجمالي العينات', value: sampleMetrics.total, tone: 'bg-slate-50 text-slate-700 ring-slate-200' },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-2xl p-4 ring-1 ${item.tone}`}>
                      <p className="text-xs font-semibold">{item.label}</p>
                      <p className="mt-2 text-2xl font-bold">{formatNumber(item.value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">وحدات العمل داخل الدراسة</h2>
                    <p className="mt-1 text-sm text-slate-500">تنقل مباشر بين الإعداد، العينات، الاستمارة، والنتائج.</p>
                  </div>
                  <Bot className="h-5 w-5 text-slate-400" />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    { title: 'تأسيس الدراسة', description: 'البيانات الأساسية والبروتوكول.', to: '/studies?create=1&workflow=supervised', icon: FileText },
                    { title: 'معالج المنهجية', description: 'العشوائية والتعمية والإعدادات.', to: quickStudyRoutes.overview, icon: Sparkles },
                    { title: 'دليل العينات والتحقق', description: 'تسجيل المرضى والمتابعة.', to: quickStudyRoutes.patients, icon: Users },
                    { title: 'استعراض الاستمارة', description: 'بناء واعتماد CRF.', to: quickStudyRoutes.form, icon: ClipboardCheck },
                    { title: 'التحليل والتقارير', description: 'التحليل الإحصائي والمخرجات.', to: quickStudyRoutes.analysis, icon: BarChart3 },
                  ].map(({ title, description, to, icon: Icon }) => (
                    <Link key={title} to={to} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-teal-300 hover:bg-teal-50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-teal-700 shadow-sm">
                          <Icon className="h-5 w-5" />
                        </div>
                      </div>
                      <p className="mt-4 font-semibold text-slate-900">{title}</p>
                      <p className="mt-1 text-sm text-slate-500">{description}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">أحدث الدراسات</h2>
                    <p className="mt-1 text-sm text-slate-500">ملخص سريع للدراسات الموجودة وحالتها الحالية.</p>
                  </div>
                  <Link to="/studies" className="text-sm font-semibold text-teal-600 hover:underline">
                    عرض جميع الدراسات
                  </Link>
                </div>

                {studies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    لا توجد دراسات بعد. يمكنك البدء من زر "تأسيس دراسة جديدة".
                  </div>
                ) : (
                  <div className="space-y-4">
                    {studies.slice(0, 5).map((study) => (
                      <div key={study.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">{study.title}</h3>
                            <p className="mt-1 text-sm text-slate-500">
                              {study.studyType} • {formatNumber(study.targetSampleSize)} مشارك مستهدف • {formatDate(study.updatedAt)}
                            </p>
                            <p className="mt-2 text-sm text-slate-600">
                              {study.supervisorName || study.assistantSupervisorName || study.assignedClinicalEvaluatorName || 'بدون تعيينات إضافية'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                              {getReadableStudyStatus(study.status)}
                            </span>
                            <Link to={`/studies/${study.id}`} className="text-xs font-semibold text-teal-600 hover:underline">
                              فتح لوحة الدراسة
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 p-5 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-semibold text-blue-700">خطة الحساب الحالية</p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900">{subscriptionLabel}</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      الحالة: {subscriptionStatus}
                      {user?.subscription?.expiresAt ? ` • تنتهي في ${formatDate(user.subscription.expiresAt)}` : ''}
                      {!user?.subscription?.expiresAt && user?.trialEndsAt ? ` • تنتهي التجربة في ${formatDate(user.trialEndsAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link to="/subscriptions" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">
                      عرض الخطط
                    </Link>
                    <Link to="/studies" className="rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50">
                      فتح الدراسات
                    </Link>
                  </div>
                </div>
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">ملف الدراسة الحالي</h2>
                    <p className="mt-1 text-sm text-slate-500">ملخص سريع للدراسة المختارة حاليًا داخل اللوحة.</p>
                  </div>
                  <FolderKanban className="h-5 w-5 text-slate-400" />
                </div>

                {!focusStudy ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    اختر دراسة أو أنشئ دراسة جديدة لبدء العمل.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">{focusStudy.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{focusStudy.studyType}</p>
                      <p className="mt-3 text-sm text-slate-600">
                        الحالة: {getReadableStudyStatus(focusStudy.status)} • المرضى المسجلون: {formatNumber(focusStudy.enrolledPatients)} / {formatNumber(focusStudy.targetSampleSize)}
                      </p>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">العشوائية</span>
                        <span className={`font-semibold ${focusStudy.hasRandomization ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {focusStudy.hasRandomization ? 'مفعلة' : 'غير مفعلة'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">التعمية</span>
                        <span className={`font-semibold ${focusStudy.hasBlinding ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {focusStudy.hasBlinding ? 'مفعلة' : 'غير مفعلة'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">التقييم السريري</span>
                        <span className={`font-semibold ${focusStudy.requiresClinicalEvaluation ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {focusStudy.requiresClinicalEvaluation ? 'مطلوب' : 'غير مطلوب'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">استمارة الفحص</span>
                        <span className={`font-semibold ${overview?.approvedTemplate ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {overview?.approvedTemplate ? `Version ${overview.approvedTemplate.versionNumber}` : 'لم تعتمد بعد'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="workspace-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">إجراءات الذكاء الاصطناعي</h2>
                    <p className="mt-1 text-sm text-slate-500">أهم الأدوات الذكية المرتبطة بالبروتوكول والنتائج.</p>
                  </div>
                  <Sparkles className="h-5 w-5 text-slate-400" />
                </div>

                <div className="space-y-3">
                  <Link to={quickStudyRoutes.analysis} className="block rounded-2xl border border-slate-200 p-4 transition hover:border-blue-300 hover:bg-blue-50">
                    <p className="font-semibold text-slate-900">المساعد الإحصائي المعمى</p>
                    <p className="mt-1 text-sm text-slate-500">تحليل داخلي أو خارجي، مع ربط الدراسة الحالية عند الحاجة.</p>
                  </Link>
                  <Link to={quickStudyRoutes.form} className="block rounded-2xl border border-slate-200 p-4 transition hover:border-blue-300 hover:bg-blue-50">
                    <p className="font-semibold text-slate-900">توليد وإدارة استمارة الفحص</p>
                    <p className="mt-1 text-sm text-slate-500">إنشاء النسخ واعتمادها ومراجعة التعديلات المقترحة.</p>
                  </Link>
                  <Link to={quickStudyRoutes.files} className="block rounded-2xl border border-slate-200 p-4 transition hover:border-blue-300 hover:bg-blue-50">
                    <p className="font-semibold text-slate-900">البروتوكول والملفات المرجعية</p>
                    <p className="mt-1 text-sm text-slate-500">الوصول السريع إلى ملفات الدراسة المرفوعة داخل المنصة.</p>
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </ResearchWorkspaceShell>
  );
}

export default StudentDashboard;
