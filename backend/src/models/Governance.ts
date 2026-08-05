import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { query } from '../db.js';

export type PhaseNumber = 1 | 2 | 3;
export type PhaseApprovalStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'needs_revision';

export type GovernanceDeliverable = {
  id: string;
  label: string;
  completed: boolean;
  notes?: string;
};

export type GovernancePhase = {
  studyId: string;
  phase: PhaseNumber;
  title: string;
  description: string;
  status: PhaseApprovalStatus;
  submittedAt?: string;
  submittedBy?: string;
  submittedByName?: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedByName?: string;
  decisionNotes?: string;
  revisionRequests?: string;
  deliverables: GovernanceDeliverable[];
};

export type GovernanceAuditLog = {
  id: string;
  requestId?: string;
  sampleId?: string;
  entryId?: string;
  actorUserId?: string;
  actorUserName?: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type GovernanceNotification = {
  id: string;
  userId: string;
  type: 'phase_approval' | 'validation_issue' | 'assessment_request' | 'assessment_submitted' | 'comment' | 'system' | 'template_update';
  title: string;
  message: string;
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  linkPath?: string;
  readAt?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export type GovernanceSnapshot = {
  phases: GovernancePhase[];
  auditLogs: GovernanceAuditLog[];
  notifications: GovernanceNotification[];
};

export type PhaseApprovalGate = {
  studyId: string;
  targetPhase: PhaseNumber;
  targetLabel: string;
  allowed: boolean;
  requiredStatus: 'approved';
  blockers: Array<{
    phase: PhaseNumber;
    title: string;
    status: PhaseApprovalStatus;
  }>;
  message: string;
};

export class PhaseApprovalError extends Error {
  code = 'PHASE_APPROVAL_REQUIRED';
  statusCode = 409;
  details: PhaseApprovalGate;

  constructor(details: PhaseApprovalGate) {
    super(details.message);
    this.name = 'PhaseApprovalError';
    this.details = details;
  }
}

export class GovernanceValidationError extends Error {
  code: string;
  statusCode: number;
  details: Record<string, unknown>;

  constructor(code: string, message: string, statusCode = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GovernanceValidationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type GovernanceRow = {
  snapshot_json: GovernanceSnapshot | string | null;
};

export const PHASE_INFO: Record<PhaseNumber, { title: string; description: string; deliverables: string[] }> = {
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

const localAuthFallbackEnabled = () => process.env.ENABLE_LOCAL_AUTH_FALLBACK !== 'false';
const isDatabaseUnavailable = (error: unknown) => localAuthFallbackEnabled() && error instanceof Error;
const localGovernanceStorePath = path.resolve(process.cwd(), 'data', 'dev-governance.json');

const parseJsonValue = <T>(value: T | string | null | undefined, fallback: T): T => {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const isPhaseNumber = (value: unknown): value is PhaseNumber => value === 1 || value === 2 || value === 3;
const phaseStatusesThatEnterWorkflow: PhaseApprovalStatus[] = ['pending', 'approved'];
const phaseDecisionStatuses: PhaseApprovalStatus[] = ['approved', 'rejected', 'needs_revision'];
const phaseDecisionAccountTypes = ['supervisor', 'assistant_supervisor', 'institution'];
const phaseSubmissionAccountTypes = ['student', 'co_researcher', 'supervisor', 'assistant_supervisor'];

const normalizePhaseStatus = (value: unknown): PhaseApprovalStatus => {
  const valid: PhaseApprovalStatus[] = ['not_submitted', 'pending', 'approved', 'rejected', 'needs_revision'];
  return valid.includes(value as PhaseApprovalStatus) ? (value as PhaseApprovalStatus) : 'not_submitted';
};

const defaultGovernanceState = (studyId: string): GovernanceSnapshot => ({
  phases: ([1, 2, 3] as PhaseNumber[]).map((phase) => ({
    studyId,
    phase,
    title: `Phase ${phase} - ${PHASE_INFO[phase].title}`,
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

const normalizeSnapshot = (studyId: string, raw: GovernanceSnapshot | Record<string, unknown> | null | undefined): GovernanceSnapshot => {
  const fallback = defaultGovernanceState(studyId);
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawPhases = Array.isArray(source.phases) ? source.phases : [];
  const phaseMap = new Map<number, Record<string, unknown>>();

  for (const item of rawPhases) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const phase = Number((item as Record<string, unknown>).phase);
    if (isPhaseNumber(phase)) {
      phaseMap.set(phase, item as Record<string, unknown>);
    }
  }

  const phases = ([1, 2, 3] as PhaseNumber[]).map((phase) => {
    const current = phaseMap.get(phase) ?? {};
    const rawDeliverables = Array.isArray(current.deliverables) ? current.deliverables : [];
    const deliverables = PHASE_INFO[phase].deliverables.map((defaultLabel, index) => {
      const sourceDeliverable =
        rawDeliverables[index] && typeof rawDeliverables[index] === 'object'
          ? (rawDeliverables[index] as Record<string, unknown>)
          : null;
      return {
        id: String(sourceDeliverable?.id || `phase-${phase}-${index + 1}`),
        label: String(sourceDeliverable?.label || defaultLabel),
        completed: Boolean(sourceDeliverable?.completed),
        notes: typeof sourceDeliverable?.notes === 'string' ? sourceDeliverable.notes : undefined,
      };
    });

    return {
      studyId,
      phase,
      title: typeof current.title === 'string' && current.title.trim() ? current.title : fallback.phases[phase - 1].title,
      description:
        typeof current.description === 'string' && current.description.trim()
          ? current.description
          : PHASE_INFO[phase].description,
      status: normalizePhaseStatus(current.status),
      submittedAt: typeof current.submittedAt === 'string' ? current.submittedAt : undefined,
      submittedBy: current.submittedBy != null ? String(current.submittedBy) : undefined,
      submittedByName: typeof current.submittedByName === 'string' ? current.submittedByName : undefined,
      decidedAt: typeof current.decidedAt === 'string' ? current.decidedAt : undefined,
      decidedBy: current.decidedBy != null ? String(current.decidedBy) : undefined,
      decidedByName: typeof current.decidedByName === 'string' ? current.decidedByName : undefined,
      decisionNotes: typeof current.decisionNotes === 'string' ? current.decisionNotes : undefined,
      revisionRequests: typeof current.revisionRequests === 'string' ? current.revisionRequests : undefined,
      deliverables,
    };
  });

  const auditLogs = Array.isArray(source.auditLogs)
    ? source.auditLogs
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: String(item.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          requestId: item.requestId != null ? String(item.requestId) : undefined,
          sampleId: item.sampleId != null ? String(item.sampleId) : undefined,
          entryId: item.entryId != null ? String(item.entryId) : undefined,
          actorUserId: item.actorUserId != null ? String(item.actorUserId) : undefined,
          actorUserName: typeof item.actorUserName === 'string' ? item.actorUserName : undefined,
          action: typeof item.action === 'string' ? item.action : 'governance_update',
          details: item.details && typeof item.details === 'object' ? (item.details as Record<string, unknown>) : {},
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }))
    : [];

  const notifications = Array.isArray(source.notifications)
    ? source.notifications
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: String(item.id || `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          userId: String(item.userId || 'unknown'),
          type: (typeof item.type === 'string' ? item.type : 'system') as GovernanceNotification['type'],
          title: typeof item.title === 'string' ? item.title : 'Governance update',
          message: typeof item.message === 'string' ? item.message : '',
          severity: typeof item.severity === 'string' ? (item.severity as GovernanceNotification['severity']) : undefined,
          linkPath: typeof item.linkPath === 'string' ? item.linkPath : undefined,
          readAt: typeof item.readAt === 'string' ? item.readAt : undefined,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          meta: item.meta && typeof item.meta === 'object' ? (item.meta as Record<string, unknown>) : undefined,
        }))
    : [];

  return { phases, auditLogs, notifications };
};

const buildPhaseApprovalGate = (
  studyId: string,
  snapshot: GovernanceSnapshot,
  targetPhase: PhaseNumber,
  targetLabel?: string,
): PhaseApprovalGate => {
  const label = targetLabel || `Phase ${targetPhase} - ${PHASE_INFO[targetPhase].title}`;
  const blockers = snapshot.phases
    .filter((phase) => phase.phase < targetPhase && phase.status !== 'approved')
    .map((phase) => ({
      phase: phase.phase,
      title: phase.title,
      status: phase.status,
    }));

  const blockerSummary = blockers.map((blocker) => `Phase ${blocker.phase} is ${blocker.status}`).join('; ');

  return {
    studyId,
    targetPhase,
    targetLabel: label,
    allowed: blockers.length === 0,
    requiredStatus: 'approved',
    blockers,
    message:
      blockers.length === 0
        ? `${label} is allowed because all prior phases are approved.`
        : `${label} is blocked until all prior phases are approved. ${blockerSummary}.`,
  };
};

const assertSequentialPhaseProgression = (studyId: string, snapshot: GovernanceSnapshot) => {
  for (const phase of snapshot.phases) {
    if (phase.phase === 1 || !phaseStatusesThatEnterWorkflow.includes(phase.status)) {
      continue;
    }

    const gate = buildPhaseApprovalGate(
      studyId,
      snapshot,
      phase.phase,
      `Phase ${phase.phase} ${phase.status.replace(/_/g, ' ')}`,
    );
    if (!gate.allowed) {
      throw new PhaseApprovalError(gate);
    }
  }
};

const getPhase = (snapshot: GovernanceSnapshot, phaseNumber: PhaseNumber) =>
  snapshot.phases.find((phase) => phase.phase === phaseNumber);

const phaseDeliverablesComplete = (phase: GovernancePhase) =>
  phase.deliverables.length > 0 && phase.deliverables.every((deliverable) => deliverable.completed);

const assertPhaseTransitionIsAuthorized = (
  previous: GovernanceSnapshot,
  next: GovernanceSnapshot,
  actorAccountType?: string,
) => {
  for (const nextPhase of next.phases) {
    const previousPhase = getPhase(previous, nextPhase.phase);

    if ((nextPhase.status === 'pending' || nextPhase.status === 'approved') && !phaseDeliverablesComplete(nextPhase)) {
      throw new GovernanceValidationError(
        'PHASE_DELIVERABLES_INCOMPLETE',
        `Phase ${nextPhase.phase} cannot be ${nextPhase.status.replace(/_/g, ' ')} until all deliverables are completed.`,
        400,
        {
          phase: nextPhase.phase,
          status: nextPhase.status,
          incompleteDeliverables: nextPhase.deliverables
            .filter((deliverable) => !deliverable.completed)
            .map((deliverable) => deliverable.label),
        },
      );
    }

    const statusChanged = previousPhase?.status !== nextPhase.status;
    if (!statusChanged) {
      const deliverablesChanged =
        previousPhase?.status === 'approved' &&
        JSON.stringify(previousPhase.deliverables) !== JSON.stringify(nextPhase.deliverables);
      if (deliverablesChanged && !phaseDecisionAccountTypes.includes(String(actorAccountType))) {
        throw new GovernanceValidationError(
          'PHASE_APPROVED_DELIVERABLE_LOCKED',
          `Phase ${nextPhase.phase} deliverables are locked after approval.`,
          403,
          { phase: nextPhase.phase },
        );
      }
      continue;
    }

    if (nextPhase.status === 'pending' && !phaseSubmissionAccountTypes.includes(String(actorAccountType))) {
      throw new GovernanceValidationError(
        'PHASE_SUBMISSION_FORBIDDEN',
        `This account cannot submit Phase ${nextPhase.phase} for approval.`,
        403,
        { phase: nextPhase.phase, accountType: actorAccountType },
      );
    }

    if (phaseDecisionStatuses.includes(nextPhase.status) && !phaseDecisionAccountTypes.includes(String(actorAccountType))) {
      throw new GovernanceValidationError(
        'PHASE_DECISION_FORBIDDEN',
        `Only supervisor or institution accounts can set Phase ${nextPhase.phase} to ${nextPhase.status.replace(/_/g, ' ')}.`,
        403,
        { phase: nextPhase.phase, status: nextPhase.status, accountType: actorAccountType },
      );
    }
  }
};

const readLocalSnapshots = async (): Promise<Record<string, GovernanceSnapshot>> => {
  try {
    return JSON.parse(await readFile(localGovernanceStorePath, 'utf8')) as Record<string, GovernanceSnapshot>;
  } catch {
    return {};
  }
};

const writeLocalSnapshots = async (payload: Record<string, GovernanceSnapshot>) => {
  await mkdir(path.dirname(localGovernanceStorePath), { recursive: true });
  await writeFile(localGovernanceStorePath, JSON.stringify(payload, null, 2), 'utf8');
};

export const getGovernanceByStudy = async (studyId: string): Promise<GovernanceSnapshot> => {
  try {
    const result = await query<GovernanceRow>(
      `SELECT snapshot_json
       FROM study_governance_snapshots
       WHERE study_id = $1
       LIMIT 1`,
      [studyId],
    );

    return normalizeSnapshot(studyId, parseJsonValue(result.rows[0]?.snapshot_json, defaultGovernanceState(studyId)));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const payload = await readLocalSnapshots();
    return normalizeSnapshot(studyId, payload[studyId]);
  }
};

export const getPhaseApprovalGate = async (
  studyId: string,
  targetPhase: PhaseNumber,
  targetLabel?: string,
): Promise<PhaseApprovalGate> => {
  const snapshot = await getGovernanceByStudy(studyId);
  return buildPhaseApprovalGate(studyId, snapshot, targetPhase, targetLabel);
};

export const saveGovernanceByStudy = async (
  studyId: string,
  actorUserId: string,
  snapshot: GovernanceSnapshot,
  actorAccountType?: string,
): Promise<GovernanceSnapshot> => {
  const normalized = normalizeSnapshot(studyId, snapshot);
  const previous = await getGovernanceByStudy(studyId);
  assertPhaseTransitionIsAuthorized(previous, normalized, actorAccountType);
  assertSequentialPhaseProgression(studyId, normalized);

  try {
    const result = await query<GovernanceRow>(
      `INSERT INTO study_governance_snapshots (study_id, snapshot_json, updated_by_user_id, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (study_id)
       DO UPDATE SET
         snapshot_json = EXCLUDED.snapshot_json,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()
       RETURNING snapshot_json`,
      [studyId, JSON.stringify(normalized), actorUserId],
    );

    return normalizeSnapshot(studyId, parseJsonValue(result.rows[0]?.snapshot_json, normalized));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const payload = await readLocalSnapshots();
    payload[studyId] = normalized;
    await writeLocalSnapshots(payload);
    return normalized;
  }
};
