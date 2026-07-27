import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardList, FileText, LoaderCircle, LogOut, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type AssessmentRequest = {
  id: string;
  studyId: string;
  studyTitle: string;
  studyType: string;
  requestedByName?: string;
  requestStatus: 'new' | 'accepted' | 'rejected' | 'active' | 'completed' | 'archived';
  assessmentType: string;
  deadlineAt?: string;
  samplesRequired: number;
  samplesSubmitted: number;
  optionalMessage?: string;
  assessorAcademicId?: string;
};

function ClinicalEvaluatorDashboard() {
  const navigate = useNavigate();
  const { user, signOut, token } = useAuth();
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<AssessmentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingId, setIsSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US').format(value);

  const fetchRequests = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load assessor requests');
      }

      const data = (await response.json()) as AssessmentRequest[];
      setRequests(data);
    } catch {
      setError('Unable to load outcome assessor requests.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const stats = [
    { key: 'requestedCases', value: formatNumber(requests.length), icon: ClipboardList },
    {
      key: 'acceptedResults',
      value: formatNumber(requests.filter((request) => request.requestStatus === 'completed').length),
      icon: CheckCircle2,
    },
    {
      key: 'awaitingAction',
      value: formatNumber(requests.filter((request) => request.requestStatus === 'new').length),
      icon: FileText,
    },
  ] as const;

  const groupedRequests = useMemo(
    () => ({
      new: requests.filter((request) => request.requestStatus === 'new'),
      active: requests.filter((request) => ['accepted', 'active'].includes(request.requestStatus)),
      completed: requests.filter((request) => ['completed', 'archived'].includes(request.requestStatus)),
    }),
    [requests],
  );

  const respondToRequest = async (requestId: string, action: 'accept' | 'reject') => {
    if (!token) {
      return;
    }

    try {
      setError('');
      setIsSubmittingId(requestId);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to update request');
      }

      await fetchRequests();
    } catch {
      setError('Unable to update assessment request.');
    } finally {
      setIsSubmittingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              {t('dashboard.common.appName')}
            </h2>
            <p className="mt-2 text-sm text-slate-400">Outcome assessor dashboard</p>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">{t('dashboard.clinicalEvaluator.badge')}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {t('dashboard.clinicalEvaluator.greeting', {
                  name: user?.fullName ?? t('dashboard.common.fallbackSupervisor'),
                })}
              </h1>
              <p className="mt-2 text-slate-600">Manage new requests, active assessments, and completed blinded outcome reviews.</p>
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
                <p className="mt-1 text-slate-600">{t(`dashboard.clinicalEvaluator.metrics.${key}`)}</p>
              </div>
            ))}
          </div>

          {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

          {isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3 text-slate-600">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>Loading outcome assessor requests...</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-6">
              {([
                { key: 'new', title: 'New Requests', description: 'Accept or reject incoming independent assessment requests.' },
                { key: 'active', title: 'Active Studies', description: 'Continue assessments already accepted and currently in progress.' },
                { key: 'completed', title: 'Completed / Archived', description: 'Review submitted and archived assessor assignments.' },
              ] as const).map((section) => (
                <div key={section.key} className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                  <div className="flex items-center gap-3">
                    <Stethoscope className="h-5 w-5 text-blue-700" />
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">{section.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                    </div>
                  </div>

                  {(groupedRequests[section.key] ?? []).length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      No requests in this section.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      {(groupedRequests[section.key] ?? []).map((request) => (
                        <div key={request.id} className="rounded-2xl border border-slate-200 p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">{request.studyTitle}</h3>
                              <p className="mt-1 text-sm text-slate-600">
                                {request.studyType} • {request.assessmentType}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Requested by {request.requestedByName || 'Research team'}
                                {request.assessorAcademicId ? ` • ${request.assessorAcademicId}` : ''}
                              </p>
                            </div>
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                              {request.requestStatus}
                            </span>
                          </div>

                          {request.optionalMessage ? (
                            <p className="mt-3 text-sm text-slate-600">{request.optionalMessage}</p>
                          ) : null}

                          <div className="mt-3 text-xs text-slate-500">
                            {request.samplesSubmitted}/{request.samplesRequired} samples submitted
                            {request.deadlineAt ? ` • Deadline ${request.deadlineAt}` : ''}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {request.requestStatus === 'new' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void respondToRequest(request.id, 'accept')}
                                  disabled={isSubmittingId === request.id}
                                  className="rounded-lg bg-green-100 px-4 py-2 font-medium text-green-700 hover:bg-green-200 disabled:opacity-60"
                                >
                                  {isSubmittingId === request.id ? 'Updating...' : 'Accept'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void respondToRequest(request.id, 'reject')}
                                  disabled={isSubmittingId === request.id}
                                  className="rounded-lg bg-rose-100 px-4 py-2 font-medium text-rose-700 hover:bg-rose-200 disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}

                            {request.requestStatus !== 'rejected' ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/outcome-assessment/${request.id}`)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
                              >
                                Open Workspace
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default ClinicalEvaluatorDashboard;
