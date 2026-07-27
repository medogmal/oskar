import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, CreditCard, FileText, Home, LoaderCircle, LogOut, Share2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
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
  reviewDecision?: 'approved' | 'changes_requested' | 'rejected';
  principalInvestigatorName?: string;
  supervisorName?: string;
  updatedAt: string;
};

function CoResearcherDashboard() {
  const navigate = useNavigate();
  const { user, signOut, token } = useAuth();
  const { t, i18n } = useTranslation();
  const [studies, setStudies] = useState<Study[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const formatNumber = useCallback(
    (value: number) => new Intl.NumberFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US').format(value),
    [i18n.language],
  );

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
    [i18n.language],
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
    } catch {
      setError(t('studies.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void fetchStudies();
  }, [fetchStudies]);

  const stats = useMemo(
    () =>
      [
        { key: 'assignedStudies', value: formatNumber(studies.length), icon: FileText },
        {
          key: 'sharedWorkspaces',
          value: formatNumber(studies.filter((study) => ['approved', 'active', 'completed'].includes(study.status)).length),
          icon: Share2,
        },
        {
          key: 'teamThreads',
          value: formatNumber(studies.filter((study) => study.reviewDecision === 'changes_requested').length),
          icon: Users,
        },
      ] as const,
    [formatNumber, studies],
  );

  const highlightedStudies = studies.slice(0, 4);

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              {t('dashboard.common.appName')}
            </h2>
            <p className="mt-2 text-sm text-slate-400">{t('dashboard.coResearcher.sidebarDescription')}</p>
          </div>

          <div className="p-6">
            <nav className="space-y-2">
              <Link to="/co-researcher-dashboard" className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white">
                <Home className="h-5 w-5" />
                <span>{t('dashboard.common.sidebar.dashboard')}</span>
              </Link>
              <Link to="/studies" className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
                <FileText className="h-5 w-5" />
                <span>{t('dashboard.common.sidebar.myStudies')}</span>
              </Link>
              <Link to="/ai-chat" className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
                <Bot className="h-5 w-5" />
                <span>{t('dashboard.common.sidebar.aiAssistant')}</span>
              </Link>
              <Link to="/subscriptions" className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
                <CreditCard className="h-5 w-5" />
                <span>الاشتراكات</span>
              </Link>
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">{t('dashboard.coResearcher.badge')}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {t('dashboard.coResearcher.greeting', {
                  name: user?.fullName ?? t('dashboard.common.fallbackResearcher'),
                })}
              </h1>
              <p className="mt-2 text-slate-600">{t('dashboard.coResearcher.subtitle')}</p>
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

          {error ? (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          ) : null}

          {isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3 text-slate-600">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>{t('studies.messages.loading')}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                {stats.map(({ key, value, icon: Icon }) => (
                  <div key={key} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
                    <p className="mt-1 text-slate-600">{t(`dashboard.coResearcher.metrics.${key}`)}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-900">الخطة الحالية</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {user?.subscription?.plan ?? (user?.trialEndsAt ? 'Trial' : 'No active plan')}
                    {user?.subscription?.status ? ` • ${user.subscription.status}` : ''}
                  </p>
                  <div className="mt-4">
                    <Link to="/subscriptions" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">
                      عرض الخطط
                    </Link>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-xl font-bold text-slate-900">{t('dashboard.coResearcher.permissions.title')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('dashboard.coResearcher.permissions.subtitle')}</p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-600">
                    <li>- {t('dashboard.coResearcher.permissions.items.createAndUpdate')}</li>
                    <li>- {t('dashboard.coResearcher.permissions.items.workspace')}</li>
                    <li>- {t('dashboard.coResearcher.permissions.items.files')}</li>
                  </ul>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-xl font-bold text-slate-900">{t('dashboard.coResearcher.nextSteps.title')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('dashboard.coResearcher.nextSteps.subtitle')}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link to="/studies" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">
                      {t('dashboard.coResearcher.nextSteps.openStudies')}
                    </Link>
                    <Link to="/ai-chat" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      {t('dashboard.coResearcher.nextSteps.openWorkspace')}
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{t('dashboard.coResearcher.nextSteps.openStudies')}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t('dashboard.coResearcher.subtitle')}</p>
                  </div>
                </div>

                {highlightedStudies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    {t('studies.empty.description')}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {highlightedStudies.map((study) => (
                      <div key={study.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">{study.title}</h3>
                            <p className="mt-1 text-sm text-slate-500">
                              {study.studyType} • {formatNumber(study.targetSampleSize)} • {formatDate(study.updatedAt)}
                            </p>
                            <p className="mt-2 text-sm text-slate-600">
                              {study.principalInvestigatorName || t('dashboard.common.fallbackResearcher')}
                              {study.supervisorName ? ` • ${study.supervisorName}` : ''}
                            </p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {t(`studies.status.${study.status}`)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default CoResearcherDashboard;
