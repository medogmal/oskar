import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, FileText, Home, LoaderCircle, LogOut, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import StudyResourcePanel from '../components/StudyResourcePanel';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type ReviewQueueStudy = {
  id: string;
  title: string;
  description?: string;
  principalInvestigatorName?: string;
  studyType: string;
  workflowType: 'supervised' | 'migration';
  status: 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  targetSampleSize: number;
  enrolledPatients: number;
  submittedAt: string;
};

function SupervisorDashboard() {
  const navigate = useNavigate();
  const { user, signOut, token } = useAuth();
  const { t, i18n } = useTranslation();
  const [queue, setQueue] = useState<ReviewQueueStudy[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingId, setIsSubmittingId] = useState<string | null>(null);
  const [expandedStudyId, setExpandedStudyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US').format(value);

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));

  const fetchQueue = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies/review/queue`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load supervisor queue');
      }

      const data = (await response.json()) as ReviewQueueStudy[];
      setQueue(data);
    } catch {
      setError(t('dashboard.supervisor.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const stats = [
    { key: 'activeStudents', value: formatNumber(new Set(queue.map((study) => study.principalInvestigatorName)).size), icon: Users },
    { key: 'pendingApprovals', value: formatNumber(queue.length), icon: ClipboardCheck },
    { key: 'reviewedStudies', value: formatNumber(0), icon: CheckCircle2 },
  ] as const;

  const handleReview = async (
    studyId: string,
    decision: 'approved' | 'changes_requested' | 'rejected',
  ) => {
    if (!token) {
      return;
    }

    try {
      setError('');
      setIsSubmittingId(studyId);

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          decision,
          reviewNotes: reviewNotes[studyId] ?? '',
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string; errors?: Array<{ message?: string }> };
        const validationMessage = data.errors?.map((item) => item.message).filter(Boolean).join(' ');
        throw new Error(validationMessage || data.message || 'Unable to review study');
      }

      setQueue((prev) => prev.filter((study) => study.id !== studyId));
      setReviewNotes((prev) => {
        const next = { ...prev };
        delete next[studyId];
        return next;
      });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : t('dashboard.supervisor.messages.reviewError'));
    } finally {
      setIsSubmittingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
              {t('dashboard.common.appName')}
            </h2>
            <p className="mt-2 text-sm text-slate-400">{t('dashboard.supervisor.sidebarDescription')}</p>
          </div>

          <div className="p-6">
            <nav className="space-y-2">
              <Link
                to="/supervisor-dashboard"
                className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white"
              >
                <Home className="h-5 w-5" />
                <span>{t('dashboard.common.sidebar.dashboard')}</span>
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-start font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white"
              >
                <Users className="h-5 w-5" />
                <span>{t('dashboard.supervisor.sidebar.students')}</span>
              </button>
              <div className="flex w-full items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-start font-medium text-white">
                <FileText className="h-5 w-5" />
                <span>{t('dashboard.supervisor.sidebar.reviews')}</span>
              </div>
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">{t('dashboard.supervisor.badge')}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {t('dashboard.supervisor.greeting', {
                  name: user?.fullName ?? t('dashboard.common.fallbackSupervisor'),
                })}
              </h1>
              <p className="mt-2 text-slate-600">{t('dashboard.supervisor.subtitle')}</p>
              <p className="mt-2 text-sm text-slate-500">
                {user?.email ?? t('dashboard.common.signedIn')}
                {user?.university ? ` • ${user.university}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                {t('dashboard.common.logout')}
              </button>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {stats.map(({ key, value, icon: Icon }) => (
              <div key={key} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
                <p className="mt-1 text-slate-600">{t(`dashboard.supervisor.metrics.${key}`)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{t('dashboard.supervisor.pending.title')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('dashboard.supervisor.pending.subtitle')}</p>
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
            ) : null}

            {isLoading ? (
              <div className="flex min-h-[220px] items-center justify-center rounded-2xl bg-slate-50">
                <div className="flex items-center gap-3 text-slate-600">
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  <span>{t('dashboard.supervisor.messages.loading')}</span>
                </div>
              </div>
            ) : queue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="text-lg font-semibold text-slate-900">{t('dashboard.supervisor.pending.emptyTitle')}</p>
                <p className="mt-2 text-sm text-slate-500">{t('dashboard.supervisor.pending.emptyDescription')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {queue.map((study) => (
                  <div key={study.id} className="rounded-2xl border border-slate-200 p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-slate-900">{study.title}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {t('dashboard.supervisor.pending.study.studentLabel', {
                            name: study.principalInvestigatorName ?? t('dashboard.common.fallbackResearcher'),
                          })}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {study.studyType} • {formatNumber(study.targetSampleSize)} • {formatDate(study.submittedAt)}
                        </p>
                      </div>
                      <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                        {t('studies.status.pending')}
                      </span>
                    </div>

                    <p className="text-sm text-slate-600">{study.description || t('studies.labels.noDescription')}</p>

                    <div className="mt-4">
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        {t('dashboard.supervisor.pending.reviewNotes')}
                      </label>
                      <textarea
                        value={reviewNotes[study.id] ?? ''}
                        onChange={(event) =>
                          setReviewNotes((prev) => ({
                            ...prev,
                            [study.id]: event.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t('dashboard.supervisor.pending.reviewNotesPlaceholder')}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedStudyId((current) => (current === study.id ? null : study.id))}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {expandedStudyId === study.id ? t('studies.actions.cancel') : t('studies.actions.viewDetails')}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingId === study.id}
                        onClick={() => void handleReview(study.id, 'approved')}
                        className="rounded-lg bg-green-100 px-4 py-2 font-medium text-green-700 hover:bg-green-200 disabled:opacity-60"
                      >
                        {t('dashboard.supervisor.pending.actions.approve')}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingId === study.id}
                        onClick={() => void handleReview(study.id, 'changes_requested')}
                        className="rounded-lg bg-yellow-100 px-4 py-2 font-medium text-yellow-700 hover:bg-yellow-200 disabled:opacity-60"
                      >
                        {t('dashboard.supervisor.pending.actions.requestChanges')}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingId === study.id}
                        onClick={() => void handleReview(study.id, 'rejected')}
                        className="rounded-lg bg-red-100 px-4 py-2 font-medium text-red-700 hover:bg-red-200 disabled:opacity-60"
                      >
                        {t('dashboard.supervisor.pending.actions.reject')}
                      </button>
                      {isSubmittingId === study.id ? (
                        <span className="inline-flex items-center gap-2 px-2 text-sm text-slate-500">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          {t('dashboard.supervisor.messages.submitting')}
                        </span>
                      ) : null}
                    </div>

                    {expandedStudyId === study.id && token ? (
                      <div className="mt-4">
                        <StudyResourcePanel studyId={study.id} token={token} compact />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default SupervisorDashboard;
