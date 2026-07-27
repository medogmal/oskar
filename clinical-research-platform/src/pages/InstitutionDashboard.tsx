import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Building2, Home, LoaderCircle, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type InstitutionOverview = {
  totalStudents: number;
  totalSupervisors: number;
  totalAssistantSupervisors: number;
  totalClinicalEvaluators: number;
  totalResearchers: number;
  activeStudies: number;
  pendingStudies: number;
  completedStudies: number;
  totalStudies: number;
  specializationBreakdown: Array<{
    specialization: string;
    totalUsers: number;
  }>;
};

function InstitutionDashboard() {
  const navigate = useNavigate();
  const { user, signOut, token } = useAuth();
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<InstitutionOverview | null>(null);
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

  const fetchOverview = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/auth/institution-overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load institution overview');
      }

      const data = (await response.json()) as InstitutionOverview;
      setOverview(data);
    } catch {
      setError(t('studies.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const stats = useMemo(
    () =>
      [
        { key: 'totalStudents', value: formatNumber(overview?.totalStudents ?? 0), icon: Users },
        { key: 'supervisors', value: formatNumber(overview?.totalSupervisors ?? 0), icon: Building2 },
        { key: 'activeStudies', value: formatNumber(overview?.activeStudies ?? 0), icon: Archive },
      ] as const,
    [formatNumber, overview],
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              {t('dashboard.common.appName')}
            </h2>
            <p className="mt-2 text-sm text-slate-400">{t('dashboard.institution.sidebarDescription')}</p>
          </div>

          <div className="p-6">
            <nav className="space-y-2">
              <Link
                to="/institution-dashboard"
                className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white"
              >
                <Home className="h-5 w-5" />
                <span>{t('dashboard.common.sidebar.dashboard')}</span>
              </Link>
              <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-300">
                <Users className="h-5 w-5" />
                <span>{t('dashboard.institution.sidebar.humanResources')}</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-300">
                <Archive className="h-5 w-5" />
                <span>{t('dashboard.institution.sidebar.archive')}</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-300">
                <ShieldCheck className="h-5 w-5" />
                <span>{t('dashboard.institution.sidebar.irb')}</span>
              </div>
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">{t('dashboard.institution.badge')}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {t('dashboard.institution.greeting', {
                  name: user?.fullName ?? t('dashboard.common.fallbackInstitution'),
                })}
              </h1>
              <p className="mt-2 text-slate-600">{t('dashboard.institution.subtitle')}</p>
              <p className="mt-2 text-sm text-slate-500">
                {user?.email ?? t('dashboard.common.signedIn')}
                {user?.institutionType ? ` • ${user.institutionType}` : ''}
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
                    <p className="mt-1 text-slate-600">{t(`dashboard.institution.metrics.${key}`)}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-xl font-bold text-slate-900">{t('dashboard.institution.statistics.title')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('dashboard.institution.statistics.subtitle')}</p>

                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">{t('dashboard.institution.sidebar.humanResources')}</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overview?.totalResearchers ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">{t('dashboard.institution.sidebar.archive')}</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overview?.totalStudies ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">{t('studies.status.pending')}</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overview?.pendingStudies ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">{t('studies.status.completed')}</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overview?.completedStudies ?? 0)}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-xl font-bold text-slate-900">{t('dashboard.institution.statistics.specializations.title')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('dashboard.institution.statistics.growth.title')}</p>

                  {overview?.specializationBreakdown?.length ? (
                    <ul className="mt-6 space-y-3">
                      {overview.specializationBreakdown.map((item) => (
                        <li key={item.specialization} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                          <span className="text-slate-700">{item.specialization}</span>
                          <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                            {formatNumber(item.totalUsers)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      {t('dashboard.institution.statistics.subtitle')}
                    </div>
                  )}

                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm text-slate-500">Assistant Supervisors</p>
                      <p className="mt-2 text-xl font-bold text-slate-900">{formatNumber(overview?.totalAssistantSupervisors ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-sm text-slate-500">Clinical Evaluators</p>
                      <p className="mt-2 text-xl font-bold text-slate-900">{formatNumber(overview?.totalClinicalEvaluators ?? 0)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default InstitutionDashboard;
