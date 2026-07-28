import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bell,
  ChevronRight,
  FileCheck,
  LoaderCircle,
  Printer,
  UploadCloud,
  X,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { SeverityBadge } from '../components/SeverityBadges';
import type { AppNotification, AuditLogEntry, PhaseApproval, PhaseApprovalStatus, PhaseNumber } from '../types/clinresearch';
import { buildBlankReport, exportReportPdf, exportReportXlsx } from '../lib/exportLib';
import { apiBaseUrl, getDashboardPath } from '../lib/auth';
import { loadWorkspaceData, uploadWorkspaceData } from '../lib/studyWorkspaceFiles';

type TabKey = 'phases' | 'audit' | 'notifications' | 'versions';

type TemplateVersion = {
  id: string;
  versionNumber: number;
  approvalStatus: 'approved' | 'pending_approval' | 'rejected';
  createdByName?: string;
  approvedByName?: string;
  changeNotes?: string;
  approvedAt?: string;
  createdAt: string;
  template: Array<{ id: string; label: string; section?: string; responseType?: string }>;
};

type GovernanceSnapshot = {
  phases: PhaseApproval[];
  auditLogs: AuditLogEntry[];
  notifications: AppNotification[];
};

type StudySummary = {
  id: string;
  title: string;
};

const PHASE_INFO: Record<PhaseNumber, { title: string; description: string; deliverables: string[] }> = {
  1: {
    title: 'Knowledge Base & RAG Setup',
    description: 'Reference governance, metadata catalog, isolation, and retrieval checks.',
    deliverables: [
      'Scientific references received and catalogued',
      'References classified by study type and scope',
      'Knowledge index and metadata catalog created',
      'Reference isolation verified',
      'RAG retrieval reviewed against sample questions',
    ],
  },
  2: {
    title: 'Clinical & Statistical Logic',
    description: 'Proposal extraction, CRF validation, variable mapping, and statistical linkage.',
    deliverables: [
      'Research proposal structure reviewed',
      'CRF / variables aligned with objectives and RQs',
      'Variable mapping matrix reviewed',
      'Clinical and statistical validation completed',
    ],
  },
  3: {
    title: 'Prompts & Integration',
    description: 'Prompt coverage, report templates, and integration handoff.',
    deliverables: [
      'Prompt coverage checked',
      'Error catalog and reporting templates reviewed',
      'Reviewable delivery bundle prepared',
      'Integration handoff completed',
    ],
  },
};

const STATUS_STYLE: Record<PhaseApprovalStatus, string> = {
  not_submitted: 'bg-slate-700/70 text-slate-300 ring-slate-600',
  pending: 'bg-amber-500/20 text-amber-300 ring-amber-500/40',
  approved: 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40',
  rejected: 'bg-rose-500/20 text-rose-300 ring-rose-500/40',
  needs_revision: 'bg-orange-500/20 text-orange-300 ring-orange-500/40',
};

const defaultGovernanceState = (studyId: string): GovernanceSnapshot => ({
  phases: ([1, 2, 3] as PhaseNumber[]).map((phase) => ({
    studyId,
    phase,
    title: `Phase ${phase} — ${PHASE_INFO[phase].title}`,
    description: PHASE_INFO[phase].description,
    status: 'not_submitted',
    deliverables: PHASE_INFO[phase].deliverables.map((label, index) => ({
      id: `phase-${phase}-${index + 1}`,
      label,
      completed: false,
    })),
  })),
  auditLogs: [],
  notifications: [],
});

const loadGovernanceSnapshot = async (studyId: string, token: string) => {
  try {
    const response = await fetch(`${apiBaseUrl}/studies/${studyId}/governance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return (await response.json()) as GovernanceSnapshot;
    }
  } catch {
    // Fall back to study-file snapshots when the dedicated API is unavailable.
  }

  return loadWorkspaceData<GovernanceSnapshot>(studyId, token, 'governance', defaultGovernanceState(studyId));
};

const saveGovernanceSnapshot = async (studyId: string, token: string, snapshot: GovernanceSnapshot) => {
  try {
    const response = await fetch(`${apiBaseUrl}/studies/${studyId}/governance`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
    });
    if (response.ok) {
      return;
    }
  } catch {
    // Fall back to study-file snapshots when the dedicated API is unavailable.
  }

  await uploadWorkspaceData(studyId, token, 'governance', snapshot);
};

const appendAudit = (
  logs: AuditLogEntry[],
  actorUserId: string | undefined,
  actorUserName: string | undefined,
  action: string,
  details: Record<string, unknown>,
): AuditLogEntry[] => [
  {
    id: crypto.randomUUID(),
    actorUserId,
    actorUserName,
    action,
    details,
    createdAt: new Date().toISOString(),
  },
  ...logs,
];

const appendNotification = (
  notifications: AppNotification[],
  userId: string,
  title: string,
  message: string,
  severity: AppNotification['severity'] = 'info',
): AppNotification[] => [
  {
    id: crypto.randomUUID(),
    userId,
    type: 'phase_approval',
    title,
    message,
    severity,
    createdAt: new Date().toISOString(),
  },
  ...notifications,
];

const buildDiffLines = (left?: TemplateVersion, right?: TemplateVersion) => {
  if (!left || !right) {
    return [] as Array<{ kind: 'added' | 'removed' | 'same'; text: string }>;
  }

  const leftMap = new Map(left.template.map((field) => [field.id || field.label, field]));
  const rightMap = new Map(right.template.map((field) => [field.id || field.label, field]));
  const allKeys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()]));

  return allKeys.map((key) => {
    const leftField = leftMap.get(key);
    const rightField = rightMap.get(key);
    if (leftField && !rightField) {
      return { kind: 'removed' as const, text: `${leftField.section || 'General'} / ${leftField.label}` };
    }
    if (!leftField && rightField) {
      return { kind: 'added' as const, text: `${rightField.section || 'General'} / ${rightField.label}` };
    }
    return { kind: 'same' as const, text: `${rightField?.section || leftField?.section || 'General'} / ${rightField?.label || leftField?.label || key}` };
  });
};

export default function ProjectGovernance() {
  const navigate = useNavigate();
  const { id: studyId = 'demo' } = useParams();
  const { user, token } = useAuth();
  const [tab, setTab] = useState<TabKey>('phases');
  const [governance, setGovernance] = useState<GovernanceSnapshot>(defaultGovernanceState(studyId));
  const [isLoading, setIsLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [decision, setDecision] = useState<{ phase: PhaseNumber; status: PhaseApprovalStatus } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [studyTitle, setStudyTitle] = useState('Study Governance');
  const [templateVersions, setTemplateVersions] = useState<TemplateVersion[]>([]);
  const [leftVersionId, setLeftVersionId] = useState('');
  const [rightVersionId, setRightVersionId] = useState('');
  const dashboardPath = getDashboardPath(user?.accountType ?? 'student');

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setSaveError('');

        const [snapshot, studyResponse, overviewResponse] = await Promise.all([
          loadGovernanceSnapshot(studyId, token),
          fetch(`${apiBaseUrl}/studies/${studyId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/overview`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const studyPayload = studyResponse.ok ? ((await studyResponse.json()) as StudySummary) : null;
        const overviewPayload = overviewResponse.ok ? ((await overviewResponse.json()) as { templateVersions?: TemplateVersion[] }) : null;

        if (cancelled) {
          return;
        }

        setGovernance(snapshot);
        setStudyTitle(studyPayload?.title || 'Study Governance');
        const versions = overviewPayload?.templateVersions ?? [];
        setTemplateVersions(versions);
        if (versions.length >= 2) {
          setRightVersionId(String(versions[0].id));
          setLeftVersionId(String(versions[1].id));
        } else if (versions.length === 1) {
          setRightVersionId(String(versions[0].id));
          setLeftVersionId(String(versions[0].id));
        }
        setHasLoaded(true);
      } catch {
        if (!cancelled) {
          setGovernance(defaultGovernanceState(studyId));
          setSaveError('تعذر تحميل بيانات الحوكمة من الدراسة الحالية.');
          setHasLoaded(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId, token]);

  useEffect(() => {
    if (!token || !hasLoaded) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        await saveGovernanceSnapshot(studyId, token, governance);
      } catch {
        setSaveError('تعذر حفظ تحديثات الحوكمة على الدراسة.');
      }
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [governance, hasLoaded, studyId, token]);

  const progress = useMemo(() => {
    const completed = governance.phases.reduce((count, phase) => count + phase.deliverables.filter((item) => item.completed).length, 0);
    const total = governance.phases.reduce((count, phase) => count + phase.deliverables.length, 0);
    const approved = governance.phases.filter((phase) => phase.status === 'approved').length;
    return {
      completed,
      total,
      approved,
      pct: total ? Math.round((completed / total) * 100) : 0,
    };
  }, [governance.phases]);

  const canApprove = ['supervisor', 'assistant_supervisor', 'institution', 'clinical_evaluator'].includes(user?.accountType ?? '');

  const mutateGovernance = (updater: (current: GovernanceSnapshot) => GovernanceSnapshot) => {
    setGovernance((current) => updater(current));
  };

  const toggleDeliverable = (phaseNumber: PhaseNumber, deliverableId: string, completed: boolean) => {
    mutateGovernance((current) => ({
      ...current,
      phases: current.phases.map((phase) =>
        phase.phase === phaseNumber
          ? {
              ...phase,
              deliverables: phase.deliverables.map((item) => (item.id === deliverableId ? { ...item, completed } : item)),
            }
          : phase,
      ),
    }));
  };

  const submitPhase = (phaseNumber: PhaseNumber) => {
    mutateGovernance((current) => {
      const updatedPhases: PhaseApproval[] = current.phases.map((phase) =>
        phase.phase === phaseNumber
          ? {
              ...phase,
              status: 'pending' as PhaseApprovalStatus,
              submittedAt: new Date().toISOString(),
              submittedBy: user?.id,
              submittedByName: user?.fullName,
            }
          : phase,
      );
      return {
        phases: updatedPhases,
        auditLogs: appendAudit(current.auditLogs, user?.id, user?.fullName, 'phase_submitted', { phase: phaseNumber }),
        notifications: appendNotification(
          current.notifications,
          user?.id ?? 'unknown',
          `Phase ${phaseNumber} submitted`,
          `Phase ${phaseNumber} has been submitted for approval.`,
        ),
      };
    });
  };

  const confirmDecision = () => {
    if (!decision) {
      return;
    }

    mutateGovernance((current) => ({
      phases: current.phases.map((phase): PhaseApproval =>
        phase.phase === decision.phase
          ? {
              ...phase,
              status: decision.status,
              decidedAt: new Date().toISOString(),
              decidedBy: user?.id,
              decidedByName: user?.fullName,
              decisionNotes: decisionNotes,
              revisionRequests: decision.status === 'needs_revision' ? decisionNotes : undefined,
            }
          : phase,
      ),
      auditLogs: appendAudit(current.auditLogs, user?.id, user?.fullName, `phase_${decision.status}`, {
        phase: decision.phase,
        notes: decisionNotes,
      }),
      notifications: appendNotification(
        current.notifications,
        user?.id ?? 'unknown',
        `Phase ${decision.phase} ${decision.status}`,
        decisionNotes || `Phase ${decision.phase} updated to ${decision.status}.`,
        decision.status === 'approved' ? 'low' : decision.status === 'rejected' ? 'critical' : 'high',
      ),
    }));
    setDecision(null);
    setDecisionNotes('');
  };

  const markAllNotificationsRead = () => {
    setGovernance((current) => ({
      ...current,
      notifications: current.notifications.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    }));
  };

  const buildGovernanceReport = () => {
    const report = buildBlankReport('final_supervisor', studyId, 'Project Governance Report', user?.fullName ?? 'Research Platform');
    report.studyTitle = studyTitle;
    report.sections = governance.phases.map((phase) => ({
      id: `phase-${phase.phase}`,
      heading: phase.title,
      level: 2,
      body: `${phase.description}\n\nStatus: ${phase.status}\nSubmitted: ${phase.submittedAt ?? 'N/A'}\nDecision notes: ${phase.decisionNotes ?? 'N/A'}`,
      tables: [
        {
          caption: `Deliverables for phase ${phase.phase}`,
          columns: ['Deliverable', 'Completed'],
          rows: phase.deliverables.map((item) => [item.label, item.completed ? 'Yes' : 'No']),
        },
      ],
    }));
    return report;
  };

  const exportReportAsPdf = async () => {
    if (!token) {
      return;
    }
    try {
      setSaveError('');
      await exportReportPdf(buildGovernanceReport(), token);
    } catch {
      setSaveError('تعذر تصدير تقرير الحوكمة بصيغة PDF.');
    }
  };

  const exportReportAsXlsx = async () => {
    if (!token) {
      return;
    }
    try {
      setSaveError('');
      await exportReportXlsx(buildGovernanceReport(), token);
    } catch {
      setSaveError('تعذر تصدير تقرير الحوكمة بصيغة XLSX.');
    }
  };

  const leftVersion = templateVersions.find((version) => String(version.id) === leftVersionId);
  const rightVersion = templateVersions.find((version) => String(version.id) === rightVersionId);
  const diffLines = buildDiffLines(leftVersion, rightVersion);

  return (
    <ResearchWorkspaceShell
      title="Project Governance"
      subtitle="Phase approvals, audit trail, notifications, and template versions"
      currentStudyLabel={studyTitle}
      navItems={buildResearchWorkspaceNav(studyId).map((item) => ({
        ...item,
        active:
          (item.key === 'dashboard' && dashboardPath === '/student-dashboard' && false) ||
          item.key === 'access',
      }))}
      actions={
        <button
          onClick={() => navigate(`/studies/${studyId}`)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          الرجوع للدراسة
        </button>
      }
    >
      <div className="space-y-6">
        {saveError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{saveError}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <FileCheck className="h-5 w-5 text-violet-500" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">Governance Workspace</h1>
              <p className="text-xs text-slate-500">
                {isLoading ? 'Loading governance state...' : `${progress.completed}/${progress.total} deliverables complete • ${progress.approved}/3 phases approved`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void exportReportAsPdf()} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100">
              <Printer className="h-4 w-4" /> Export PDF
            </button>
            <button onClick={() => void exportReportAsXlsx()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
              <UploadCloud className="h-4 w-4" /> Export XLSX
            </button>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(['phases', 'audit', 'notifications', 'versions'] as TabKey[]).map((entry) => (
                <button
                  key={entry}
                  onClick={() => setTab(entry)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === entry ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                >
                  {entry === 'phases' ? 'Phases' : entry === 'audit' ? 'Audit' : entry === 'notifications' ? 'Notifications' : 'Versions'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === 'phases' ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-slate-900 to-emerald-900 p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-indigo-200">Project Progress</div>
                  <div className="mt-1 text-2xl font-black">{progress.pct}% complete</div>
                </div>
                <div className="rounded-xl bg-white/10 px-4 py-3 text-sm">
                  {progress.approved} phase(s) approved
                </div>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-gradient-to-r from-sky-400 via-fuchsia-400 to-emerald-400" style={{ width: `${progress.pct}%` }} />
              </div>
            </div>

            {governance.phases.map((phase) => {
              const completeCount = phase.deliverables.filter((item) => item.completed).length;
              return (
                <div key={phase.phase} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-900">{phase.title}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${STATUS_STYLE[phase.status]}`}>
                          {phase.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{phase.description}</p>
                    </div>
                    <div className="text-sm font-semibold text-slate-700">
                      {completeCount}/{phase.deliverables.length} deliverables
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr]">
                    <div className="space-y-2">
                      {phase.deliverables.map((item) => (
                        <label key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <input
                            type="checkbox"
                            checked={item.completed}
                            disabled={phase.status === 'approved'}
                            onChange={(event) => toggleDeliverable(phase.phase, item.id, event.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-sm text-slate-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">
                        Submitted: {phase.submittedAt ? new Date(phase.submittedAt).toLocaleString() : 'Not submitted yet'}
                      </div>
                      <div className="text-xs text-slate-500">
                        Decision: {phase.decidedAt ? new Date(phase.decidedAt).toLocaleString() : 'No decision yet'}
                      </div>
                      {phase.decisionNotes ? <div className="rounded-lg bg-white p-3 text-sm text-slate-700">{phase.decisionNotes}</div> : null}
                      {(phase.status === 'not_submitted' || phase.status === 'needs_revision') && completeCount === phase.deliverables.length ? (
                        <button onClick={() => submitPhase(phase.phase)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700">
                          <UploadCloud className="h-4 w-4" /> Submit for approval
                        </button>
                      ) : null}
                      {phase.status === 'pending' && canApprove ? (
                        <div className="grid gap-2">
                          <button onClick={() => setDecision({ phase: phase.phase, status: 'approved' })} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                            Approve
                          </button>
                          <button onClick={() => setDecision({ phase: phase.phase, status: 'needs_revision' })} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
                            Request revisions
                          </button>
                          <button onClick={() => setDecision({ phase: phase.phase, status: 'rejected' })} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">
                            Reject
                          </button>
                        </div>
                      ) : null}
                      {phase.status === 'pending' && !canApprove ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          Waiting for reviewer sign-off.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Audit Trail</h2>
            </div>
            {governance.auditLogs.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No audit events recorded yet.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {governance.auditLogs.map((entry) => (
                  <div key={entry.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{entry.action}</span>
                      <span className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{entry.actorUserName || 'Unknown actor'}</div>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(entry.details, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'notifications' ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Notifications</h2>
              <button onClick={markAllNotificationsRead} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                Mark all read
              </button>
            </div>
            {governance.notifications.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No notifications yet.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {governance.notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() =>
                      setGovernance((current) => ({
                        ...current,
                        notifications: current.notifications.map((item) =>
                          item.id === notification.id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item,
                        ),
                      }))
                    }
                    className={`flex w-full items-start gap-3 px-5 py-4 text-left ${notification.readAt ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="mt-0.5">{notification.severity ? <SeverityBadge severity={notification.severity} /> : <Bell className="h-4 w-4 text-slate-400" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{notification.title}</div>
                        {!notification.readAt ? <span className="h-2 w-2 rounded-full bg-violet-500" /> : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{notification.message}</div>
                      <div className="mt-2 text-[11px] text-slate-400">{new Date(notification.createdAt).toLocaleString()}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'versions' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Template Versions</h2>
                  <p className="text-xs text-slate-500">Live versions loaded from outcome assessment records.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select value={leftVersionId} onChange={(event) => setLeftVersionId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    {templateVersions.map((version) => (
                      <option key={version.id} value={String(version.id)}>
                        v{version.versionNumber}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-slate-500">vs</span>
                  <select value={rightVersionId} onChange={(event) => setRightVersionId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    {templateVersions.map((version) => (
                      <option key={version.id} value={String(version.id)}>
                        v{version.versionNumber}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!templateVersions.length ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  <LoaderCircle className="h-4 w-4" />
                  No approved template versions are available yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {diffLines.map((line, index) => (
                    <div
                      key={`${line.kind}-${index}`}
                      className={`rounded-lg px-4 py-2 text-sm ${
                        line.kind === 'added'
                          ? 'bg-emerald-50 text-emerald-700'
                          : line.kind === 'removed'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-slate-50 text-slate-500'
                      }`}
                    >
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : '='} {line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-lg font-bold text-slate-900">Version Timeline</h3>
              </div>
              {templateVersions.length === 0 ? (
                <div className="p-8 text-sm text-slate-500">No version history yet.</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {templateVersions.map((version) => (
                    <div key={version.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">v{version.versionNumber}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${version.approvalStatus === 'approved' ? 'bg-emerald-50 text-emerald-700' : version.approvalStatus === 'pending_approval' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                          {version.approvalStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-700">{version.changeNotes || 'No change notes provided.'}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        Created by {version.createdByName || 'Unknown'} • {new Date(version.createdAt).toLocaleString()} • {version.template.length} field(s)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {decision ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Phase Decision</h2>
                <button onClick={() => setDecision(null)} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Phase {decision.phase} → {decision.status.replace(/_/g, ' ')}
              </p>
              <textarea
                value={decisionNotes}
                onChange={(event) => setDecisionNotes(event.target.value)}
                rows={5}
                className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-violet-500"
                placeholder="Add reviewer notes here..."
              />
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setDecision(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={confirmDecision}
                  disabled={decision.status !== 'approved' && !decisionNotes.trim()}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ResearchWorkspaceShell>
  );
}
