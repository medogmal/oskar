import { query } from '../db.js';
import {
  buildBlindingSettings,
  normalizeStudyGroups,
  type BlindingSettings,
  type RandomizationMethod,
} from '../lib/studyDesign.js';

export interface IStudy {
  id?: string;
  title: string;
  description: string;
  principalInvestigator: string;
  supervisor?: string;
  status: 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  studyType: string;
  hasRandomization: boolean;
  hasBlinding: boolean;
  randomizationMethod?: string;
  blindingType?: string;
  targetSampleSize: number;
  protocolFile?: string;
  irbApprovalNumber?: string;
  irbApprovalDate?: Date;
  startDate?: Date;
  endDate?: Date;
  crf: any;
  statisticalAnalysisPlan?: any;
  auditTrail: Array<{
    action: string;
    performedBy: string;
    timestamp: Date;
    details?: string;
  }>;
}

export type StudyStatus = 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
export type StudyWorkflowType = 'supervised' | 'migration';
export type ReviewDecision = 'approved' | 'changes_requested' | 'rejected';
export type ClinicalEvaluationDecision = 'pending' | 'accepted' | 'needs_revision' | 'not_recommended';

export type StudySummary = {
  id: string;
  title: string;
  description?: string;
  principalInvestigatorName?: string;
  principalInvestigatorAcademicId?: string;
  coResearcherUserId?: string;
  coResearcherName?: string;
  coResearcherAcademicId?: string;
  supervisorUserId?: string;
  supervisorName?: string;
  supervisorAcademicId?: string;
  assistantSupervisorUserId?: string;
  assistantSupervisorName?: string;
  assistantSupervisorAcademicId?: string;
  assignedClinicalEvaluatorUserId?: string;
  assignedClinicalEvaluatorName?: string;
  assignedClinicalEvaluatorAcademicId?: string;
  studyType: string;
  workflowType: StudyWorkflowType;
  status: StudyStatus;
  targetSampleSize: number;
  enrolledPatients: number;
  hasRandomization: boolean;
  hasBlinding: boolean;
  randomizationMethod?: RandomizationMethod;
  groups: string[];
  blindingSettings?: BlindingSettings;
  protocolFileName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  reviewDecision?: ReviewDecision;
  reviewNotes?: string;
  reviewedAt?: string;
  reviewedByName?: string;
  requiresClinicalEvaluation: boolean;
  isLocked: boolean;
  lockedAt?: string;
  lockedByUserId?: string;
  lockedByName?: string;
  clinicalEvaluationDecision?: ClinicalEvaluationDecision;
  clinicalEvaluationNotes?: string;
  clinicalEvaluatedAt?: string;
  clinicalEvaluatedByName?: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type StudyRow = {
  id: string | number;
  title: string;
  description: string | null;
  study_type: string;
  workflow_type: StudyWorkflowType;
  status: StudyStatus;
  target_sample_size: number;
  enrolled_patients: number;
  has_randomization: boolean;
  has_blinding: boolean;
  randomization_method: RandomizationMethod | null;
  groups_json: string[] | string | null;
  blinding_config_json: BlindingSettings | string | null;
  protocol_file_name: string | null;
  ethics_approval_number: string | null;
  clinical_registration_number: string | null;
  review_decision: ReviewDecision | null;
  review_notes: string | null;
  reviewed_at: Date | string | null;
  reviewed_by_name: string | null;
  requires_clinical_evaluation: boolean;
  is_locked: boolean;
  locked_at: Date | string | null;
  locked_by_user_id: string | number | null;
  locked_by_name: string | null;
  clinical_evaluation_decision: ClinicalEvaluationDecision | null;
  clinical_evaluation_notes: string | null;
  clinical_evaluated_at: Date | string | null;
  clinical_evaluated_by_name: string | null;
  principal_investigator_name: string | null;
  principal_investigator_academic_id: string | null;
  co_researcher_user_id: string | number | null;
  co_researcher_name: string | null;
  co_researcher_academic_id: string | null;
  supervisor_user_id: string | number | null;
  supervisor_name: string | null;
  supervisor_academic_id: string | null;
  assistant_supervisor_user_id: string | number | null;
  assistant_supervisor_name: string | null;
  assistant_supervisor_academic_id: string | null;
  assigned_clinical_evaluator_user_id: string | number | null;
  assigned_clinical_evaluator_name: string | null;
  assigned_clinical_evaluator_academic_id: string | null;
  submitted_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CreateStudyInput = {
  principalInvestigatorId: string;
  title: string;
  description?: string;
  studyType: string;
  workflowType: StudyWorkflowType;
  targetSampleSize: number;
  hasRandomization: boolean;
  hasBlinding: boolean;
  randomizationMethod?: RandomizationMethod;
  groups?: string[];
  blindingSettings?: BlindingSettings;
  protocolFileName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  requiresClinicalEvaluation: boolean;
  coResearcherUserId?: string;
  supervisorUserId?: string;
  assistantSupervisorUserId?: string;
  clinicalEvaluatorUserId?: string;
};

export type UpdateStudyDesignInput = {
  studyId: string;
  actorUserId: string;
  groups?: string[];
  hasRandomization: boolean;
  randomizationMethod?: RandomizationMethod;
  hasBlinding: boolean;
  blindingSettings?: BlindingSettings;
  coResearcherUserId?: string | null;
  assistantSupervisorUserId?: string | null;
  clinicalEvaluatorUserId?: string | null;
  requiresClinicalEvaluation?: boolean;
};

export type LockStudyInput = {
  studyId: string;
  actorUserId: string;
};

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

const mapStudyRow = (row: StudyRow): StudySummary => ({
  id: String(row.id),
  title: row.title,
  description: row.description ?? undefined,
  principalInvestigatorName: row.principal_investigator_name ?? undefined,
  principalInvestigatorAcademicId: row.principal_investigator_academic_id ?? undefined,
  coResearcherUserId: row.co_researcher_user_id ? String(row.co_researcher_user_id) : undefined,
  coResearcherName: row.co_researcher_name ?? undefined,
  coResearcherAcademicId: row.co_researcher_academic_id ?? undefined,
  supervisorUserId: row.supervisor_user_id ? String(row.supervisor_user_id) : undefined,
  supervisorName: row.supervisor_name ?? undefined,
  supervisorAcademicId: row.supervisor_academic_id ?? undefined,
  assistantSupervisorUserId: row.assistant_supervisor_user_id ? String(row.assistant_supervisor_user_id) : undefined,
  assistantSupervisorName: row.assistant_supervisor_name ?? undefined,
  assistantSupervisorAcademicId: row.assistant_supervisor_academic_id ?? undefined,
  assignedClinicalEvaluatorUserId: row.assigned_clinical_evaluator_user_id
    ? String(row.assigned_clinical_evaluator_user_id)
    : undefined,
  assignedClinicalEvaluatorName: row.assigned_clinical_evaluator_name ?? undefined,
  assignedClinicalEvaluatorAcademicId: row.assigned_clinical_evaluator_academic_id ?? undefined,
  studyType: row.study_type,
  workflowType: row.workflow_type,
  status: row.status,
  targetSampleSize: Number(row.target_sample_size),
  enrolledPatients: Number(row.enrolled_patients),
  hasRandomization: row.has_randomization,
  hasBlinding: row.has_blinding,
  randomizationMethod: row.randomization_method ?? undefined,
  groups: normalizeStudyGroups(parseJsonValue<string[]>(row.groups_json, [])),
  blindingSettings: row.has_blinding
    ? buildBlindingSettings({
        groups: normalizeStudyGroups(parseJsonValue<string[]>(row.groups_json, [])),
        blindedParties: parseJsonValue<BlindingSettings>(row.blinding_config_json, {} as BlindingSettings).blindedParties,
        scope: parseJsonValue<BlindingSettings>(row.blinding_config_json, {} as BlindingSettings).scope,
        protocolText: parseJsonValue<BlindingSettings>(row.blinding_config_json, {} as BlindingSettings).protocolText,
        studyTitle: row.title,
      })
    : undefined,
  protocolFileName: row.protocol_file_name ?? undefined,
  ethicsApprovalNumber: row.ethics_approval_number ?? undefined,
  clinicalRegistrationNumber: row.clinical_registration_number ?? undefined,
  reviewDecision: row.review_decision ?? undefined,
  reviewNotes: row.review_notes ?? undefined,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : undefined,
  reviewedByName: row.reviewed_by_name ?? undefined,
  requiresClinicalEvaluation: row.requires_clinical_evaluation,
  isLocked: row.is_locked,
  lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : undefined,
  lockedByUserId: row.locked_by_user_id ? String(row.locked_by_user_id) : undefined,
  lockedByName: row.locked_by_name ?? undefined,
  clinicalEvaluationDecision: row.clinical_evaluation_decision ?? undefined,
  clinicalEvaluationNotes: row.clinical_evaluation_notes ?? undefined,
  clinicalEvaluatedAt: row.clinical_evaluated_at ? new Date(row.clinical_evaluated_at).toISOString() : undefined,
  clinicalEvaluatedByName: row.clinical_evaluated_by_name ?? undefined,
  submittedAt: new Date(row.submitted_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const listStudiesByUser = async (principalInvestigatorId: string): Promise<StudySummary[]> => {
  const result = await query<StudyRow>(
    `
      SELECT
        studies.*,
        principal_investigator.full_name AS principal_investigator_name,
        principal_investigator.academic_id AS principal_investigator_academic_id,
        co_researcher.full_name AS co_researcher_name,
        co_researcher.academic_id AS co_researcher_academic_id,
        supervisor.full_name AS supervisor_name,
        supervisor.academic_id AS supervisor_academic_id,
        assistant_supervisor.full_name AS assistant_supervisor_name,
        assistant_supervisor.academic_id AS assistant_supervisor_academic_id,
        assigned_clinical_evaluator.full_name AS assigned_clinical_evaluator_name,
        assigned_clinical_evaluator.academic_id AS assigned_clinical_evaluator_academic_id,
        locked_by.full_name AS locked_by_name,
        reviewer.full_name AS reviewed_by_name,
        clinical_evaluator.full_name AS clinical_evaluated_by_name
      FROM studies
      JOIN users AS principal_investigator ON principal_investigator.id = studies.principal_investigator_id
      LEFT JOIN users AS co_researcher ON co_researcher.id = studies.co_researcher_user_id
      LEFT JOIN users AS supervisor ON supervisor.id = studies.supervisor_user_id
      LEFT JOIN users AS assistant_supervisor ON assistant_supervisor.id = studies.assistant_supervisor_user_id
      LEFT JOIN users AS assigned_clinical_evaluator ON assigned_clinical_evaluator.id = studies.assigned_clinical_evaluator_user_id
      LEFT JOIN users AS locked_by ON locked_by.id = studies.locked_by_user_id
      LEFT JOIN users AS reviewer ON reviewer.id = studies.reviewed_by_user_id
      LEFT JOIN users AS clinical_evaluator ON clinical_evaluator.id = studies.clinical_evaluated_by_user_id
      WHERE studies.principal_investigator_id = $1 OR studies.co_researcher_user_id = $1
      ORDER BY studies.created_at DESC
    `,
    [principalInvestigatorId],
  );

  return result.rows.map(mapStudyRow);
};

export const findStudyByIdForUser = async (
  principalInvestigatorId: string,
  studyId: string,
): Promise<StudySummary | null> => {
  const result = await query<StudyRow>(
    `
      SELECT
        studies.*,
        principal_investigator.full_name AS principal_investigator_name,
        principal_investigator.academic_id AS principal_investigator_academic_id,
        co_researcher.full_name AS co_researcher_name,
        co_researcher.academic_id AS co_researcher_academic_id,
        supervisor.full_name AS supervisor_name,
        supervisor.academic_id AS supervisor_academic_id,
        assistant_supervisor.full_name AS assistant_supervisor_name,
        assistant_supervisor.academic_id AS assistant_supervisor_academic_id,
        assigned_clinical_evaluator.full_name AS assigned_clinical_evaluator_name,
        assigned_clinical_evaluator.academic_id AS assigned_clinical_evaluator_academic_id,
        locked_by.full_name AS locked_by_name,
        reviewer.full_name AS reviewed_by_name,
        clinical_evaluator.full_name AS clinical_evaluated_by_name
      FROM studies
      JOIN users AS principal_investigator ON principal_investigator.id = studies.principal_investigator_id
      LEFT JOIN users AS co_researcher ON co_researcher.id = studies.co_researcher_user_id
      LEFT JOIN users AS supervisor ON supervisor.id = studies.supervisor_user_id
      LEFT JOIN users AS assistant_supervisor ON assistant_supervisor.id = studies.assistant_supervisor_user_id
      LEFT JOIN users AS assigned_clinical_evaluator ON assigned_clinical_evaluator.id = studies.assigned_clinical_evaluator_user_id
      LEFT JOIN users AS locked_by ON locked_by.id = studies.locked_by_user_id
      LEFT JOIN users AS reviewer ON reviewer.id = studies.reviewed_by_user_id
      LEFT JOIN users AS clinical_evaluator ON clinical_evaluator.id = studies.clinical_evaluated_by_user_id
      WHERE (studies.principal_investigator_id = $1 OR studies.co_researcher_user_id = $1) AND studies.id = $2
      LIMIT 1
    `,
    [principalInvestigatorId, studyId],
  );

  const row = result.rows[0];
  return row ? mapStudyRow(row) : null;
};

export const createStudy = async (input: CreateStudyInput): Promise<StudySummary> => {
  if (input.workflowType === 'supervised' && !input.supervisorUserId && !input.assistantSupervisorUserId) {
    throw new Error('A supervisor or assistant supervisor must be assigned for supervised studies');
  }

  if (input.requiresClinicalEvaluation && !input.clinicalEvaluatorUserId) {
    throw new Error('A clinical evaluator must be assigned when clinical evaluation is required');
  }

  const status: StudyStatus = input.workflowType === 'migration' ? 'active' : 'pending';

  const result = await query<StudyRow>(
    `
      INSERT INTO studies (
        principal_investigator_id, title, description, study_type, workflow_type, status,
        target_sample_size, enrolled_patients, has_randomization, has_blinding, randomization_method,
        groups_json, blinding_config_json, protocol_file_name,
        ethics_approval_number, clinical_registration_number, co_researcher_user_id, supervisor_user_id,
        assistant_supervisor_user_id, assigned_clinical_evaluator_user_id,
        requires_clinical_evaluation, clinical_evaluation_decision, submitted_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 0, $8, $9, $10,
        $11::jsonb, $12::jsonb, $13,
        $14, $15, $16, $17,
        $18, $19,
        $20, $21, NOW(), NOW()
      )
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [
      input.principalInvestigatorId,
      input.title.trim(),
      input.description?.trim() || null,
      input.studyType.trim(),
      input.workflowType,
      status,
      input.targetSampleSize,
      input.hasRandomization,
      input.hasBlinding,
      input.hasRandomization ? input.randomizationMethod ?? 'simple' : null,
      JSON.stringify(normalizeStudyGroups(input.groups)),
      JSON.stringify(
        input.hasBlinding
          ? input.blindingSettings ??
              buildBlindingSettings({
                studyTitle: input.title,
                groups: input.groups,
              })
          : {},
      ),
      input.protocolFileName?.trim() || null,
      input.ethicsApprovalNumber?.trim() || null,
      input.clinicalRegistrationNumber?.trim() || null,
      input.coResearcherUserId ?? null,
      input.supervisorUserId ?? null,
      input.assistantSupervisorUserId ?? null,
      input.clinicalEvaluatorUserId ?? null,
      input.requiresClinicalEvaluation,
      input.requiresClinicalEvaluation ? 'pending' : null,
    ],
  );

  return mapStudyRow(result.rows[0]);
};

export const updateStudyDesign = async (input: UpdateStudyDesignInput): Promise<StudySummary | null> => {
  const groups = normalizeStudyGroups(input.groups);
  const blindingSettings =
    input.hasBlinding
      ? input.blindingSettings ??
        buildBlindingSettings({
          groups,
        })
      : null;

  const result = await query<StudyRow>(
    `
      UPDATE studies
      SET
        has_randomization = $1,
        randomization_method = $2,
        groups_json = $3::jsonb,
        has_blinding = $4,
        blinding_config_json = $5::jsonb,
        co_researcher_user_id = $6,
        assistant_supervisor_user_id = $7,
        assigned_clinical_evaluator_user_id = $8,
        requires_clinical_evaluation = $9,
        clinical_evaluation_decision = CASE
          WHEN $9 = FALSE THEN NULL
          WHEN COALESCE(clinical_evaluation_decision, 'pending') = 'pending' THEN 'pending'
          ELSE clinical_evaluation_decision
        END,
        updated_at = NOW()
      WHERE id = $10
        AND COALESCE(is_locked, FALSE) = FALSE
        AND (
          principal_investigator_id = $11
          OR co_researcher_user_id = $11
          OR supervisor_user_id = $11
          OR assistant_supervisor_user_id = $11
        )
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [
      input.hasRandomization,
      input.hasRandomization ? input.randomizationMethod ?? 'simple' : null,
      JSON.stringify(groups),
      input.hasBlinding,
      JSON.stringify(blindingSettings ?? {}),
      input.coResearcherUserId ?? null,
      input.assistantSupervisorUserId ?? null,
      input.requiresClinicalEvaluation ? input.clinicalEvaluatorUserId ?? null : null,
      input.requiresClinicalEvaluation ?? false,
      input.studyId,
      input.actorUserId,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return findStudyByIdForSupervisor(String(row.id));
};

export const listPendingStudiesForSupervisor = async (reviewerId: string): Promise<StudySummary[]> => {
  const result = await query<StudyRow>(
    `
      SELECT
        studies.*,
        principal_investigator.full_name AS principal_investigator_name,
        principal_investigator.academic_id AS principal_investigator_academic_id,
        co_researcher.full_name AS co_researcher_name,
        co_researcher.academic_id AS co_researcher_academic_id,
        supervisor.full_name AS supervisor_name,
        supervisor.academic_id AS supervisor_academic_id,
        assistant_supervisor.full_name AS assistant_supervisor_name,
        assistant_supervisor.academic_id AS assistant_supervisor_academic_id,
        assigned_clinical_evaluator.full_name AS assigned_clinical_evaluator_name,
        assigned_clinical_evaluator.academic_id AS assigned_clinical_evaluator_academic_id,
        locked_by.full_name AS locked_by_name,
        reviewer.full_name AS reviewed_by_name,
        clinical_evaluator.full_name AS clinical_evaluated_by_name
      FROM studies
      JOIN users AS principal_investigator ON principal_investigator.id = studies.principal_investigator_id
      LEFT JOIN users AS co_researcher ON co_researcher.id = studies.co_researcher_user_id
      LEFT JOIN users AS supervisor ON supervisor.id = studies.supervisor_user_id
      LEFT JOIN users AS assistant_supervisor ON assistant_supervisor.id = studies.assistant_supervisor_user_id
      LEFT JOIN users AS assigned_clinical_evaluator ON assigned_clinical_evaluator.id = studies.assigned_clinical_evaluator_user_id
      LEFT JOIN users AS locked_by ON locked_by.id = studies.locked_by_user_id
      LEFT JOIN users AS reviewer ON reviewer.id = studies.reviewed_by_user_id
      LEFT JOIN users AS clinical_evaluator ON clinical_evaluator.id = studies.clinical_evaluated_by_user_id
      WHERE
        studies.workflow_type = 'supervised'
        AND studies.status = 'pending'
        AND (studies.supervisor_user_id = $1 OR studies.assistant_supervisor_user_id = $1)
      ORDER BY studies.submitted_at DESC, studies.created_at DESC
    `,
    [reviewerId],
  );

  return result.rows.map(mapStudyRow);
};

export const reviewStudy = async (
  reviewerId: string,
  studyId: string,
  decision: ReviewDecision,
  reviewNotes?: string,
): Promise<StudySummary | null> => {
  const nextStatus: StudyStatus =
    decision === 'approved' ? 'approved' : decision === 'changes_requested' ? 'draft' : 'cancelled';

  const result = await query<StudyRow>(
    `
      UPDATE studies
      SET
        status = $1,
        review_decision = $2,
        review_notes = $3,
        reviewed_at = NOW(),
        reviewed_by_user_id = $4,
        updated_at = NOW()
      WHERE
        id = $5
        AND workflow_type = 'supervised'
        AND status = 'pending'
        AND (supervisor_user_id = $4 OR assistant_supervisor_user_id = $4)
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [nextStatus, decision, reviewNotes?.trim() || null, reviewerId, studyId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return findStudyByIdForSupervisor(row.id.toString());
};

export const findStudyByIdForSupervisor = async (studyId: string): Promise<StudySummary | null> => {
  const result = await query<StudyRow>(
    `
      SELECT
        studies.*,
        principal_investigator.full_name AS principal_investigator_name,
        principal_investigator.academic_id AS principal_investigator_academic_id,
        co_researcher.full_name AS co_researcher_name,
        co_researcher.academic_id AS co_researcher_academic_id,
        supervisor.full_name AS supervisor_name,
        supervisor.academic_id AS supervisor_academic_id,
        assistant_supervisor.full_name AS assistant_supervisor_name,
        assistant_supervisor.academic_id AS assistant_supervisor_academic_id,
        assigned_clinical_evaluator.full_name AS assigned_clinical_evaluator_name,
        assigned_clinical_evaluator.academic_id AS assigned_clinical_evaluator_academic_id,
        locked_by.full_name AS locked_by_name,
        reviewer.full_name AS reviewed_by_name,
        clinical_evaluator.full_name AS clinical_evaluated_by_name
      FROM studies
      JOIN users AS principal_investigator ON principal_investigator.id = studies.principal_investigator_id
      LEFT JOIN users AS co_researcher ON co_researcher.id = studies.co_researcher_user_id
      LEFT JOIN users AS supervisor ON supervisor.id = studies.supervisor_user_id
      LEFT JOIN users AS assistant_supervisor ON assistant_supervisor.id = studies.assistant_supervisor_user_id
      LEFT JOIN users AS assigned_clinical_evaluator ON assigned_clinical_evaluator.id = studies.assigned_clinical_evaluator_user_id
      LEFT JOIN users AS locked_by ON locked_by.id = studies.locked_by_user_id
      LEFT JOIN users AS reviewer ON reviewer.id = studies.reviewed_by_user_id
      LEFT JOIN users AS clinical_evaluator ON clinical_evaluator.id = studies.clinical_evaluated_by_user_id
      WHERE studies.id = $1
      LIMIT 1
    `,
    [studyId],
  );

  const row = result.rows[0];
  return row ? mapStudyRow(row) : null;
};

export const resubmitStudy = async (researcherUserId: string, studyId: string): Promise<StudySummary | null> => {
  const result = await query<StudyRow>(
    `
      UPDATE studies
      SET
        status = 'pending',
        review_decision = NULL,
        review_notes = NULL,
        reviewed_at = NULL,
        reviewed_by_user_id = NULL,
        clinical_evaluation_decision = CASE WHEN requires_clinical_evaluation THEN 'pending' ELSE NULL END,
        clinical_evaluation_notes = NULL,
        clinical_evaluated_at = NULL,
        clinical_evaluated_by_user_id = NULL,
        submitted_at = NOW(),
        updated_at = NOW()
      WHERE
        id = $1
        AND (principal_investigator_id = $2 OR co_researcher_user_id = $2)
        AND workflow_type = 'supervised'
        AND review_decision = 'changes_requested'
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [studyId, researcherUserId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return findStudyByIdForUser(researcherUserId, studyId);
};

export const listPendingStudiesForClinicalEvaluator = async (evaluatorId: string): Promise<StudySummary[]> => {
  const result = await query<StudyRow>(
    `
      SELECT
        studies.*,
        principal_investigator.full_name AS principal_investigator_name,
        principal_investigator.academic_id AS principal_investigator_academic_id,
        co_researcher.full_name AS co_researcher_name,
        co_researcher.academic_id AS co_researcher_academic_id,
        supervisor.full_name AS supervisor_name,
        supervisor.academic_id AS supervisor_academic_id,
        assistant_supervisor.full_name AS assistant_supervisor_name,
        assistant_supervisor.academic_id AS assistant_supervisor_academic_id,
        assigned_clinical_evaluator.full_name AS assigned_clinical_evaluator_name,
        assigned_clinical_evaluator.academic_id AS assigned_clinical_evaluator_academic_id,
        locked_by.full_name AS locked_by_name,
        reviewer.full_name AS reviewed_by_name,
        clinical_evaluator.full_name AS clinical_evaluated_by_name
      FROM studies
      JOIN users AS principal_investigator ON principal_investigator.id = studies.principal_investigator_id
      LEFT JOIN users AS co_researcher ON co_researcher.id = studies.co_researcher_user_id
      LEFT JOIN users AS supervisor ON supervisor.id = studies.supervisor_user_id
      LEFT JOIN users AS assistant_supervisor ON assistant_supervisor.id = studies.assistant_supervisor_user_id
      LEFT JOIN users AS assigned_clinical_evaluator ON assigned_clinical_evaluator.id = studies.assigned_clinical_evaluator_user_id
      LEFT JOIN users AS locked_by ON locked_by.id = studies.locked_by_user_id
      LEFT JOIN users AS reviewer ON reviewer.id = studies.reviewed_by_user_id
      LEFT JOIN users AS clinical_evaluator ON clinical_evaluator.id = studies.clinical_evaluated_by_user_id
      WHERE
        studies.assigned_clinical_evaluator_user_id = $1
        AND
        studies.requires_clinical_evaluation = TRUE
        AND studies.status IN ('approved', 'active', 'completed')
        AND COALESCE(studies.clinical_evaluation_decision, 'pending') IN ('pending', 'needs_revision')
      ORDER BY studies.updated_at DESC, studies.created_at DESC
    `,
    [evaluatorId],
  );

  return result.rows.map(mapStudyRow);
};

export const evaluateStudyClinically = async (
  evaluatorId: string,
  studyId: string,
  decision: Exclude<ClinicalEvaluationDecision, 'pending'>,
  notes?: string,
): Promise<StudySummary | null> => {
  const result = await query<StudyRow>(
    `
      UPDATE studies
      SET
        is_locked = CASE WHEN $1 = 'accepted' THEN TRUE ELSE FALSE END,
        locked_at = CASE WHEN $1 = 'accepted' THEN COALESCE(locked_at, NOW()) ELSE NULL END,
        locked_by_user_id = CASE WHEN $1 = 'accepted' THEN COALESCE(locked_by_user_id, $3) ELSE NULL END,
        clinical_evaluation_decision = $1,
        clinical_evaluation_notes = $2,
        clinical_evaluated_at = NOW(),
        clinical_evaluated_by_user_id = $3,
        updated_at = NOW()
      WHERE
        id = $4
        AND assigned_clinical_evaluator_user_id = $3
        AND requires_clinical_evaluation = TRUE
        AND status IN ('approved', 'active', 'completed')
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [decision, notes?.trim() || null, evaluatorId, studyId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return findStudyByIdForSupervisor(String(row.id));
};

export const lockStudyForExternalEvaluation = async (input: LockStudyInput): Promise<StudySummary | null> => {
  const result = await query<StudyRow>(
    `
      UPDATE studies
      SET
        is_locked = TRUE,
        locked_at = NOW(),
        locked_by_user_id = $1,
        requires_clinical_evaluation = TRUE,
        clinical_evaluation_decision = CASE
          WHEN COALESCE(clinical_evaluation_decision, 'pending') = 'accepted' THEN 'accepted'
          ELSE 'pending'
        END,
        updated_at = NOW()
      WHERE id = $2
        AND (principal_investigator_id = $1 OR co_researcher_user_id = $1)
      RETURNING
        studies.*,
        NULL::TEXT AS principal_investigator_name,
        NULL::TEXT AS principal_investigator_academic_id,
        NULL::TEXT AS co_researcher_name,
        NULL::TEXT AS co_researcher_academic_id,
        NULL::TEXT AS supervisor_name,
        NULL::TEXT AS supervisor_academic_id,
        NULL::TEXT AS assistant_supervisor_name,
        NULL::TEXT AS assistant_supervisor_academic_id,
        NULL::TEXT AS assigned_clinical_evaluator_name,
        NULL::TEXT AS assigned_clinical_evaluator_academic_id,
        NULL::TEXT AS locked_by_name,
        NULL::TEXT AS reviewed_by_name,
        NULL::TEXT AS clinical_evaluated_by_name
    `,
    [input.actorUserId, input.studyId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return findStudyByIdForUser(input.actorUserId, input.studyId);
};

export type InstitutionStudyOverview = {
  activeStudies: number;
  pendingStudies: number;
  completedStudies: number;
  totalStudies: number;
};

export const getInstitutionStudyOverview = async (): Promise<InstitutionStudyOverview> => {
  const result = await query<{
    total_studies: string | number;
    active_studies: string | number;
    pending_studies: string | number;
    completed_studies: string | number;
  }>(
    `
      SELECT
        COUNT(*)::BIGINT AS total_studies,
        COUNT(*) FILTER (WHERE status IN ('approved', 'active'))::BIGINT AS active_studies,
        COUNT(*) FILTER (WHERE status = 'pending')::BIGINT AS pending_studies,
        COUNT(*) FILTER (WHERE status = 'completed')::BIGINT AS completed_studies
      FROM studies
    `,
  );

  const row = result.rows[0];

  return {
    activeStudies: Number(row?.active_studies ?? 0),
    pendingStudies: Number(row?.pending_studies ?? 0),
    completedStudies: Number(row?.completed_studies ?? 0),
    totalStudies: Number(row?.total_studies ?? 0),
  };
};
