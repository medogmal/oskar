import { query } from '../db.js';
import { allocateGroup, buildGroupMaskMap, type BlindingSettings, type RandomizationMethod } from '../lib/studyDesign.js';

export type AssessmentRequestStatus = 'new' | 'accepted' | 'rejected' | 'active' | 'completed' | 'archived';
export type AssessmentEntryStatus = 'pending' | 'in_progress' | 'submitted' | 'locked' | 'reopened';
export type AssessmentTemplateApprovalStatus = 'approved' | 'pending_approval' | 'rejected';
export type AssessmentRecipientScope = 'research_team' | 'assessor_only';

export type AssessmentTemplateField = {
  id: string;
  label: string;
  responseType: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
  section?: string;
  required?: boolean;
  note?: string;
};

export type AssessmentRequestSummary = {
  id: string;
  studyId: string;
  studyTitle: string;
  studyType: string;
  assessorUserId: string;
  assessorName?: string;
  assessorAcademicId?: string;
  requestedByUserId: string;
  requestedByName?: string;
  requestStatus: AssessmentRequestStatus;
  assessmentType: string;
  deadlineAt?: string;
  samplesRequired: number;
  samplesSubmitted: number;
  optionalMessage?: string;
  createdAt: string;
  acceptedAt?: string;
  completedAt?: string;
};

export type AssessmentSampleSummary = {
  id: string;
  studyId: string;
  subjectId: string;
  visitNumber: string;
  inclusionEligible: boolean;
  allocatedGroup?: string;
  maskedGroupCode?: string;
  sampleStatus: 'pending' | 'in_progress' | 'submitted' | 'reopened';
  assets: Array<{
    id: string;
    fileId: string;
    originalName: string;
    assetType: 'photo_before' | 'photo_after' | 'xray_before' | 'xray_after' | 'stl' | 'lab_result' | 'other';
  }>;
};

export type AssessmentTemplateVersionSummary = {
  id: string;
  studyId: string;
  versionNumber: number;
  approvalStatus: AssessmentTemplateApprovalStatus;
  createdByUserId: string;
  createdByName?: string;
  approvedByUserId?: string;
  approvedByName?: string;
  changeNotes?: string;
  template: AssessmentTemplateField[];
  createdAt: string;
  approvedAt?: string;
};

export type AssessmentEntrySummary = {
  id: string;
  requestId: string;
  sampleId: string;
  assessorUserId: string;
  templateVersionId?: string;
  response: Record<string, unknown>;
  status: AssessmentEntryStatus;
  assessorComments?: string;
  submittedAt?: string;
  lockedAt?: string;
};

export type AssessmentNoteSummary = {
  id: string;
  requestId: string;
  sampleId?: string;
  authorUserId: string;
  authorName?: string;
  recipientScope: AssessmentRecipientScope;
  message: string;
  createdAt: string;
};

type AssessmentRequestRow = {
  id: string | number;
  study_id: string | number;
  study_title: string;
  study_type: string;
  assessor_user_id: string | number;
  assessor_name: string | null;
  assessor_academic_id: string | null;
  requested_by_user_id: string | number;
  requested_by_name: string | null;
  request_status: AssessmentRequestStatus;
  assessment_type: string;
  deadline_at: Date | string | null;
  samples_required: string | number;
  samples_submitted: string | number;
  optional_message: string | null;
  created_at: Date | string;
  accepted_at: Date | string | null;
  completed_at: Date | string | null;
};

type AssessmentSampleRow = {
  id: string | number;
  study_id: string | number;
  subject_id: string;
  visit_number: string;
  inclusion_eligible: boolean;
  allocated_group: string | null;
  masked_group_code: string | null;
  sample_status: 'pending' | 'in_progress' | 'submitted' | 'reopened';
  created_at: Date | string;
  updated_at: Date | string;
};

type StudyDesignRow = {
  id: string | number;
  title: string;
  has_randomization: boolean;
  randomization_method: RandomizationMethod | null;
  groups_json: string[] | string | null;
  has_blinding: boolean;
  blinding_config_json: BlindingSettings | string | null;
};

type AssessmentSampleAssetRow = {
  id: string | number;
  sample_id: string | number;
  file_id: string | number;
  original_name: string;
  asset_type: AssessmentSampleSummary['assets'][number]['assetType'];
};

type AssessmentTemplateVersionRow = {
  id: string | number;
  study_id: string | number;
  version_number: string | number;
  approval_status: AssessmentTemplateApprovalStatus;
  created_by_user_id: string | number;
  created_by_name: string | null;
  approved_by_user_id: string | number | null;
  approved_by_name: string | null;
  change_notes: string | null;
  template_json: AssessmentTemplateField[] | string | null;
  created_at: Date | string;
  approved_at: Date | string | null;
};

type AssessmentEntryRow = {
  id: string | number;
  request_id: string | number;
  sample_id: string | number;
  assessor_user_id: string | number;
  template_version_id: string | number | null;
  response_json: Record<string, unknown> | string | null;
  status: AssessmentEntryStatus;
  assessor_comments: string | null;
  submitted_at: Date | string | null;
  locked_at: Date | string | null;
};

type AssessmentNoteRow = {
  id: string | number;
  request_id: string | number;
  sample_id: string | number | null;
  author_user_id: string | number;
  author_name: string | null;
  recipient_scope: AssessmentRecipientScope;
  message: string;
  created_at: Date | string;
};

const asIsoString = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : undefined);

const localAuthFallbackEnabled = () => process.env.ENABLE_LOCAL_AUTH_FALLBACK !== 'false';

const isDevLocalId = (id?: string | number | null) =>
  typeof id === 'string' && /^dev_(study|file|analysis|request|sample|template|entry|note)_/i.test(id);

const isDatabaseUnavailable = (error: unknown, contextId?: string | number | null) => {
  if (!localAuthFallbackEnabled() || !(error instanceof Error)) {
    return false;
  }
  if (/Database has not been initialized|ECONNREFUSED|connection.*refused/i.test(error.message)) {
    return true;
  }
  if (isDevLocalId(contextId) && /invalid input syntax for type (bigint|integer)/i.test(error.message)) {
    return true;
  }
  return false;
};

const createLocalId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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

const mapSampleRow = (
  row: AssessmentSampleRow,
  options?: { maskAllocatedGroup?: boolean },
): AssessmentSampleSummary => ({
  id: String(row.id),
  studyId: String(row.study_id),
  subjectId: row.subject_id,
  visitNumber: row.visit_number,
  inclusionEligible: row.inclusion_eligible,
  allocatedGroup: options?.maskAllocatedGroup ? undefined : row.allocated_group ?? undefined,
  maskedGroupCode: row.masked_group_code ?? undefined,
  sampleStatus: row.sample_status,
  assets: [],
});

const mapRequestRow = (row: AssessmentRequestRow): AssessmentRequestSummary => ({
  id: String(row.id),
  studyId: String(row.study_id),
  studyTitle: row.study_title,
  studyType: row.study_type,
  assessorUserId: String(row.assessor_user_id),
  assessorName: row.assessor_name ?? undefined,
  assessorAcademicId: row.assessor_academic_id ?? undefined,
  requestedByUserId: String(row.requested_by_user_id),
  requestedByName: row.requested_by_name ?? undefined,
  requestStatus: row.request_status,
  assessmentType: row.assessment_type,
  deadlineAt: asIsoString(row.deadline_at),
  samplesRequired: Number(row.samples_required),
  samplesSubmitted: Number(row.samples_submitted),
  optionalMessage: row.optional_message ?? undefined,
  createdAt: asIsoString(row.created_at)!,
  acceptedAt: asIsoString(row.accepted_at),
  completedAt: asIsoString(row.completed_at),
});

const mapTemplateVersionRow = (row: AssessmentTemplateVersionRow): AssessmentTemplateVersionSummary => ({
  id: String(row.id),
  studyId: String(row.study_id),
  versionNumber: Number(row.version_number),
  approvalStatus: row.approval_status,
  createdByUserId: String(row.created_by_user_id),
  createdByName: row.created_by_name ?? undefined,
  approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : undefined,
  approvedByName: row.approved_by_name ?? undefined,
  changeNotes: row.change_notes ?? undefined,
  template: parseJsonValue<AssessmentTemplateField[]>(row.template_json, []),
  createdAt: asIsoString(row.created_at)!,
  approvedAt: asIsoString(row.approved_at),
});

const mapEntryRow = (row: AssessmentEntryRow): AssessmentEntrySummary => ({
  id: String(row.id),
  requestId: String(row.request_id),
  sampleId: String(row.sample_id),
  assessorUserId: String(row.assessor_user_id),
  templateVersionId: row.template_version_id ? String(row.template_version_id) : undefined,
  response: parseJsonValue<Record<string, unknown>>(row.response_json, {}),
  status: row.status,
  assessorComments: row.assessor_comments ?? undefined,
  submittedAt: asIsoString(row.submitted_at),
  lockedAt: asIsoString(row.locked_at),
});

const mapNoteRow = (row: AssessmentNoteRow): AssessmentNoteSummary => ({
  id: String(row.id),
  requestId: String(row.request_id),
  sampleId: row.sample_id ? String(row.sample_id) : undefined,
  authorUserId: String(row.author_user_id),
  authorName: row.author_name ?? undefined,
  recipientScope: row.recipient_scope,
  message: row.message,
  createdAt: asIsoString(row.created_at)!,
});

const inferTemplateByStudyType = (studyType: string): AssessmentTemplateField[] => {
  const normalizedType = studyType.trim().toLowerCase();

  if (normalizedType.includes('implant') || normalizedType.includes('زراعة')) {
    return [
      { id: 'bone_loss', label: 'Bone Loss', responseType: 'numeric' },
      { id: 'implant_stability', label: 'Implant Stability', responseType: 'choice', options: ['Poor', 'Fair', 'Good', 'Excellent'] },
      { id: 'osseointegration', label: 'Osseointegration', responseType: 'choice', options: ['Absent', 'Partial', 'Complete'] },
      { id: 'infection', label: 'Infection', responseType: 'boolean' },
      { id: 'soft_tissue', label: 'Soft Tissue', responseType: 'choice', options: ['Poor', 'Acceptable', 'Good'] },
      { id: 'implant_success', label: 'Implant Success', responseType: 'choice', options: ['Failure', 'Borderline', 'Success'] },
      { id: 'complications', label: 'Complications', responseType: 'text' },
      { id: 'overall_assessment', label: 'Overall Assessment', responseType: 'text' },
      { id: 'comments', label: 'Comments', responseType: 'text' },
    ];
  }

  if (normalizedType.includes('endodont') || normalizedType.includes('علاج الجذور')) {
    return [
      { id: 'healing', label: 'Healing', responseType: 'choice', options: ['Poor', 'Partial', 'Complete'] },
      { id: 'pain', label: 'Pain', responseType: 'numeric' },
      { id: 'periapical_lesion', label: 'Periapical Lesion', responseType: 'choice', options: ['Present', 'Improving', 'Resolved'] },
      { id: 'root_filling_quality', label: 'Root Filling Quality', responseType: 'choice', options: ['Poor', 'Adequate', 'Excellent'] },
      { id: 'success', label: 'Success', responseType: 'choice', options: ['No', 'Borderline', 'Yes'] },
      { id: 'comments', label: 'Comments', responseType: 'text' },
    ];
  }

  if (normalizedType.includes('orthodont') || normalizedType.includes('تقويم')) {
    return [
      { id: 'alignment', label: 'Alignment', responseType: 'choice', options: ['Poor', 'Fair', 'Good', 'Excellent'] },
      { id: 'overjet', label: 'Overjet', responseType: 'numeric' },
      { id: 'overbite', label: 'Overbite', responseType: 'numeric' },
      { id: 'root_resorption', label: 'Root Resorption', responseType: 'choice', options: ['None', 'Mild', 'Moderate', 'Severe'] },
      { id: 'treatment_outcome', label: 'Treatment Outcome', responseType: 'choice', options: ['Poor', 'Acceptable', 'Excellent'] },
      { id: 'comments', label: 'Comments', responseType: 'text' },
    ];
  }

  return [
    { id: 'primary_outcome', label: 'Primary Outcome', responseType: 'text' },
    { id: 'secondary_outcome', label: 'Secondary Outcomes', responseType: 'text' },
    { id: 'quality_rating', label: 'Quality Rating', responseType: 'choice', options: ['Poor', 'Fair', 'Good', 'Excellent'] },
    { id: 'comments', label: 'Comments', responseType: 'text' },
  ];
};

const createAuditRecord = async (input: {
  requestId?: string | number | null;
  sampleId?: string | number | null;
  entryId?: string | number | null;
  actorUserId?: string | number | null;
  action: string;
  details?: Record<string, unknown>;
}) => {
  await query(
    `
      INSERT INTO study_outcome_assessment_audit_trail (
        request_id, sample_id, entry_id, actor_user_id, action, details_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.requestId ?? null,
      input.sampleId ?? null,
      input.entryId ?? null,
      input.actorUserId ?? null,
      input.action,
      JSON.stringify(input.details ?? {}),
    ],
  );
};

const updateSampleProgressForStudy = async (studyId: string) => {
  await query(
    `
      UPDATE study_outcome_assessment_samples AS samples
      SET
        sample_status = CASE
          WHEN progress.total_entries = 0 THEN 'pending'
          WHEN progress.submitted_entries = progress.total_entries THEN 'submitted'
          WHEN progress.submitted_entries > 0 THEN 'in_progress'
          ELSE 'pending'
        END,
        updated_at = NOW()
      FROM (
        SELECT
          sample_id,
          COUNT(*)::INT AS total_entries,
          COUNT(*) FILTER (WHERE status IN ('submitted', 'locked'))::INT AS submitted_entries
        FROM study_outcome_assessment_entries
        WHERE sample_id IN (
          SELECT id FROM study_outcome_assessment_samples WHERE study_id = $1
        )
        GROUP BY sample_id
      ) AS progress
      WHERE samples.id = progress.sample_id
    `,
    [studyId],
  );
};

const updateRequestProgress = async (requestId: string) => {
  await query(
    `
      UPDATE study_outcome_assessment_requests AS requests
      SET
        request_status = CASE
          WHEN stats.total_entries > 0 AND stats.submitted_entries = stats.total_entries THEN 'completed'
          WHEN requests.request_status = 'accepted' THEN 'active'
          ELSE requests.request_status
        END,
        completed_at = CASE
          WHEN stats.total_entries > 0 AND stats.submitted_entries = stats.total_entries THEN NOW()
          ELSE requests.completed_at
        END,
        updated_at = NOW()
      FROM (
        SELECT
          request_id,
          COUNT(*)::INT AS total_entries,
          COUNT(*) FILTER (WHERE status IN ('submitted', 'locked'))::INT AS submitted_entries
        FROM study_outcome_assessment_entries
        WHERE request_id = $1
        GROUP BY request_id
      ) AS stats
      WHERE requests.id = stats.request_id
    `,
    [requestId],
  );
};

export const ensureStudyAssessmentTemplate = async (studyId: string, createdByUserId: string, studyType: string) => {
  try {
    const existing = await query<AssessmentTemplateVersionRow>(
      `
        SELECT
          versions.*,
          creator.full_name AS created_by_name,
          approver.full_name AS approved_by_name
        FROM study_outcome_assessment_template_versions AS versions
        JOIN users AS creator ON creator.id = versions.created_by_user_id
        LEFT JOIN users AS approver ON approver.id = versions.approved_by_user_id
        WHERE versions.study_id = $1
          AND versions.approval_status = 'approved'
        ORDER BY versions.version_number DESC
        LIMIT 1
      `,
      [studyId],
    );

    if (existing.rows[0]) {
      return mapTemplateVersionRow(existing.rows[0]);
    }

    const created = await query<AssessmentTemplateVersionRow>(
      `
        INSERT INTO study_outcome_assessment_template_versions (
          study_id,
          version_number,
          created_by_user_id,
          approval_status,
          template_json,
          approved_by_user_id,
          approved_at,
          updated_at
        )
        VALUES ($1, 1, $2, 'approved', $3::jsonb, $2, NOW(), NOW())
        RETURNING
          *,
          NULL::TEXT AS created_by_name,
          NULL::TEXT AS approved_by_name
      `,
      [studyId, createdByUserId, JSON.stringify(inferTemplateByStudyType(studyType))],
    );

    return mapTemplateVersionRow(created.rows[0]);
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    const now = new Date().toISOString();
    return {
      id: createLocalId('dev_template'),
      studyId,
      versionNumber: 1,
      approvalStatus: 'approved' as const,
      createdByUserId,
      template: inferTemplateByStudyType(studyType),
      createdAt: now,
      approvedAt: now,
    } satisfies AssessmentTemplateVersionSummary;
  }
};

export const listOutcomeAssessmentRequestsForStudy = async (studyId: string): Promise<AssessmentRequestSummary[]> => {
  try {
    const result = await query<AssessmentRequestRow>(
      `
        SELECT
          requests.id,
          requests.study_id,
          studies.title AS study_title,
          studies.study_type,
          requests.assessor_user_id,
          assessor.full_name AS assessor_name,
          assessor.academic_id AS assessor_academic_id,
          requests.requested_by_user_id,
          requester.full_name AS requested_by_name,
          requests.request_status,
          requests.assessment_type,
          requests.deadline_at,
          requests.samples_required,
          COUNT(entries.id) FILTER (WHERE entries.status IN ('submitted', 'locked'))::BIGINT AS samples_submitted,
          requests.optional_message,
          requests.created_at,
          requests.accepted_at,
          requests.completed_at
        FROM study_outcome_assessment_requests AS requests
        JOIN studies ON studies.id = requests.study_id
        JOIN users AS assessor ON assessor.id = requests.assessor_user_id
        JOIN users AS requester ON requester.id = requests.requested_by_user_id
        LEFT JOIN study_outcome_assessment_entries AS entries ON entries.request_id = requests.id
        WHERE requests.study_id = $1
        GROUP BY requests.id, studies.id, assessor.id, requester.id
        ORDER BY requests.created_at DESC
      `,
      [studyId],
    );

    return result.rows.map(mapRequestRow);
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return [];
  }
};

export const listOutcomeAssessmentRequestsForAssessor = async (
  assessorUserId: string,
): Promise<AssessmentRequestSummary[]> => {
  try {
    const result = await query<AssessmentRequestRow>(
      `
        SELECT
          requests.id,
          requests.study_id,
          studies.title AS study_title,
          studies.study_type,
          requests.assessor_user_id,
          assessor.full_name AS assessor_name,
          assessor.academic_id AS assessor_academic_id,
          requests.requested_by_user_id,
          requester.full_name AS requested_by_name,
          requests.request_status,
          requests.assessment_type,
          requests.deadline_at,
          requests.samples_required,
          COUNT(entries.id) FILTER (WHERE entries.status IN ('submitted', 'locked'))::BIGINT AS samples_submitted,
          requests.optional_message,
          requests.created_at,
          requests.accepted_at,
          requests.completed_at
        FROM study_outcome_assessment_requests AS requests
        JOIN studies ON studies.id = requests.study_id
        JOIN users AS assessor ON assessor.id = requests.assessor_user_id
        JOIN users AS requester ON requester.id = requests.requested_by_user_id
        LEFT JOIN study_outcome_assessment_entries AS entries ON entries.request_id = requests.id
        WHERE requests.assessor_user_id = $1
        GROUP BY requests.id, studies.id, assessor.id, requester.id
        ORDER BY requests.updated_at DESC, requests.created_at DESC
      `,
      [assessorUserId],
    );

    return result.rows.map(mapRequestRow);
  } catch (error) {
    if (!isDatabaseUnavailable(error, assessorUserId)) {
      throw error;
    }
    return [];
  }
};

export const listOutcomeAssessmentSamplesForStudy = async (studyId: string): Promise<AssessmentSampleSummary[]> => {
  try {
    const sampleResult = await query<AssessmentSampleRow>(
      `
        SELECT *
        FROM study_outcome_assessment_samples
        WHERE study_id = $1
        ORDER BY created_at ASC
      `,
      [studyId],
    );

    if (sampleResult.rows.length === 0) {
      return [];
    }

    const sampleIds = sampleResult.rows.map((row) => String(row.id));
    const assetResult = await query<AssessmentSampleAssetRow>(
      `
        SELECT
          assets.id,
          assets.sample_id,
          assets.file_id,
          files.original_name,
          assets.asset_type
        FROM study_outcome_assessment_sample_files AS assets
        JOIN study_files AS files ON files.id = assets.file_id
        WHERE assets.sample_id = ANY($1::bigint[])
        ORDER BY assets.created_at ASC
      `,
      [sampleIds],
    );

    const assetsBySample = new Map<string, AssessmentSampleSummary['assets']>();
    for (const asset of assetResult.rows) {
      const key = String(asset.sample_id);
      const current = assetsBySample.get(key) ?? [];
      current.push({
        id: String(asset.id),
        fileId: String(asset.file_id),
        originalName: asset.original_name,
        assetType: asset.asset_type,
      });
      assetsBySample.set(key, current);
    }

    return sampleResult.rows.map((row) => ({
      ...mapSampleRow(row),
      assets: assetsBySample.get(String(row.id)) ?? [],
    }));
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return [];
  }
};

export const listOutcomeAssessmentSamplesForAssessor = async (studyId: string): Promise<AssessmentSampleSummary[]> => {
  try {
    const designResult = await query<StudyDesignRow>(
      `
        SELECT id, title, has_randomization, randomization_method, groups_json, has_blinding, blinding_config_json
        FROM studies
        WHERE id = $1
        LIMIT 1
      `,
      [studyId],
    );
    const studyDesign = designResult.rows[0];
    const maskAllocatedGroup = Boolean(
      studyDesign?.has_blinding &&
        parseJsonValue<BlindingSettings>(studyDesign?.blinding_config_json, {} as BlindingSettings)?.permissions
          ?.hideMaterialsFromAssessor,
    );

    const samples = await listOutcomeAssessmentSamplesForStudy(studyId);
    return samples.map((sample) => ({
      ...sample,
      allocatedGroup: maskAllocatedGroup ? undefined : sample.allocatedGroup,
    }));
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return [];
  }
};

export const syncOutcomeAssessmentEntriesForStudy = async (studyId: string) => {
  try {
  const approvedTemplateResult = await query<{ id: string | number }>(
    `
      SELECT id
      FROM study_outcome_assessment_template_versions
      WHERE study_id = $1 AND approval_status = 'approved'
      ORDER BY version_number DESC
      LIMIT 1
    `,
    [studyId],
  );

  const activeRequestsResult = await query<{ id: string | number; assessor_user_id: string | number }>(
    `
      SELECT id, assessor_user_id
      FROM study_outcome_assessment_requests
      WHERE study_id = $1
        AND request_status IN ('accepted', 'active', 'completed')
    `,
    [studyId],
  );

  const samplesResult = await query<{ id: string | number }>(
    `
      SELECT id
      FROM study_outcome_assessment_samples
      WHERE study_id = $1
    `,
    [studyId],
  );

  const templateVersionId = approvedTemplateResult.rows[0] ? String(approvedTemplateResult.rows[0].id) : null;

  for (const requestRow of activeRequestsResult.rows) {
    for (const sampleRow of samplesResult.rows) {
      await query(
        `
          INSERT INTO study_outcome_assessment_entries (
            request_id,
            sample_id,
            assessor_user_id,
            template_version_id,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (request_id, sample_id)
          DO UPDATE SET
            template_version_id = COALESCE(EXCLUDED.template_version_id, study_outcome_assessment_entries.template_version_id),
            updated_at = NOW()
        `,
        [requestRow.id, sampleRow.id, requestRow.assessor_user_id, templateVersionId],
      );
    }

    await updateRequestProgress(String(requestRow.id));
  }

  await updateSampleProgressForStudy(studyId);
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return;
  }
};

export const upsertOutcomeAssessmentSamples = async (
  studyId: string,
  createdByUserId: string,
  samples: Array<{
    subjectId: string;
    visitNumber: string;
    inclusionEligible?: boolean;
    assetLinks?: Array<{
      fileId: string;
      assetType: AssessmentSampleSummary['assets'][number]['assetType'];
    }>;
  }>,
) => {
  const studyResult = await query<StudyDesignRow>(
    `
      SELECT id, title, has_randomization, randomization_method, groups_json, has_blinding, blinding_config_json
      FROM studies
      WHERE id = $1
      LIMIT 1
    `,
    [studyId],
  );
  const study = studyResult.rows[0];

  if (!study) {
    throw new Error('Study not found');
  }

  const groups = parseJsonValue<string[]>(study.groups_json, ['Experimental', 'Control']);
  const maskMap = buildGroupMaskMap(groups);

  for (const sample of samples) {
    const inclusionEligible = sample.inclusionEligible !== false;
    let allocatedGroup: string | null = null;
    let maskedGroupCode: string | null = null;

    if (inclusionEligible && study.has_randomization) {
      const countsResult = await query<{ allocated_group: string | null; total_count: string | number }>(
        `
          SELECT allocated_group, COUNT(*)::BIGINT AS total_count
          FROM study_outcome_assessment_samples
          WHERE study_id = $1
            AND inclusion_eligible = TRUE
            AND allocated_group IS NOT NULL
          GROUP BY allocated_group
        `,
        [studyId],
      );
      const currentCounts = countsResult.rows.reduce<Record<string, number>>((accumulator, row) => {
        if (row.allocated_group) {
          accumulator[row.allocated_group] = Number(row.total_count);
        }
        return accumulator;
      }, {});
      allocatedGroup = allocateGroup({
        groups,
        method: study.randomization_method ?? 'simple',
        currentCounts,
      });
      maskedGroupCode = maskMap[allocatedGroup] ?? null;
    }

    const inserted = await query<AssessmentSampleRow>(
      `
        INSERT INTO study_outcome_assessment_samples (
          study_id,
          subject_id,
          visit_number,
          inclusion_eligible,
          allocated_group,
          masked_group_code,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (study_id, subject_id, visit_number)
        DO UPDATE SET
          inclusion_eligible = EXCLUDED.inclusion_eligible,
          allocated_group = EXCLUDED.allocated_group,
          masked_group_code = EXCLUDED.masked_group_code,
          updated_at = NOW()
        RETURNING *
      `,
      [studyId, sample.subjectId.trim(), sample.visitNumber.trim(), inclusionEligible, allocatedGroup, maskedGroupCode],
    );

    const sampleId = String(inserted.rows[0].id);

    if (sample.assetLinks?.length) {
      for (const asset of sample.assetLinks) {
        await query(
          `
            INSERT INTO study_outcome_assessment_sample_files (
              sample_id,
              file_id,
              asset_type
            )
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `,
          [sampleId, asset.fileId, asset.assetType],
        );
      }
    }

    await createAuditRecord({
      sampleId,
      actorUserId: createdByUserId,
      action: 'sample_upserted',
      details: {
        studyId,
        subjectId: sample.subjectId,
        visitNumber: sample.visitNumber,
        inclusionEligible,
        allocatedGroup,
        maskedGroupCode,
      },
    });
  }

  await syncOutcomeAssessmentEntriesForStudy(studyId);
  return listOutcomeAssessmentSamplesForStudy(studyId);
};

export const createOutcomeAssessmentRequests = async (input: {
  studyId: string;
  studyType: string;
  assessorUserIds: string[];
  requestedByUserId: string;
  assessmentType: string;
  deadlineAt?: string;
  samplesRequired: number;
  optionalMessage?: string;
}) => {
  await ensureStudyAssessmentTemplate(input.studyId, input.requestedByUserId, input.studyType);

  const createdRequests: AssessmentRequestSummary[] = [];

  for (const assessorUserId of input.assessorUserIds) {
    const inserted = await query<AssessmentRequestRow>(
      `
        INSERT INTO study_outcome_assessment_requests (
          study_id,
          assessor_user_id,
          requested_by_user_id,
          request_status,
          assessment_type,
          deadline_at,
          samples_required,
          optional_message,
          updated_at
        )
        VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, NOW())
        ON CONFLICT (study_id, assessor_user_id)
        DO UPDATE SET
          requested_by_user_id = EXCLUDED.requested_by_user_id,
          request_status = 'new',
          assessment_type = EXCLUDED.assessment_type,
          deadline_at = EXCLUDED.deadline_at,
          samples_required = EXCLUDED.samples_required,
          optional_message = EXCLUDED.optional_message,
          accepted_at = NULL,
          rejected_at = NULL,
          completed_at = NULL,
          archived_at = NULL,
          updated_at = NOW()
        RETURNING
          study_outcome_assessment_requests.id,
          study_outcome_assessment_requests.study_id,
          (SELECT title FROM studies WHERE studies.id = study_outcome_assessment_requests.study_id) AS study_title,
          (SELECT study_type FROM studies WHERE studies.id = study_outcome_assessment_requests.study_id) AS study_type,
          study_outcome_assessment_requests.assessor_user_id,
          (SELECT full_name FROM users WHERE users.id = study_outcome_assessment_requests.assessor_user_id) AS assessor_name,
          (SELECT academic_id FROM users WHERE users.id = study_outcome_assessment_requests.assessor_user_id) AS assessor_academic_id,
          study_outcome_assessment_requests.requested_by_user_id,
          (SELECT full_name FROM users WHERE users.id = study_outcome_assessment_requests.requested_by_user_id) AS requested_by_name,
          study_outcome_assessment_requests.request_status,
          study_outcome_assessment_requests.assessment_type,
          study_outcome_assessment_requests.deadline_at,
          study_outcome_assessment_requests.samples_required,
          0::BIGINT AS samples_submitted,
          study_outcome_assessment_requests.optional_message,
          study_outcome_assessment_requests.created_at,
          study_outcome_assessment_requests.accepted_at,
          study_outcome_assessment_requests.completed_at
      `,
      [
        input.studyId,
        assessorUserId,
        input.requestedByUserId,
        input.assessmentType.trim(),
        input.deadlineAt || null,
        input.samplesRequired,
        input.optionalMessage?.trim() || null,
      ],
    );

    const request = mapRequestRow(inserted.rows[0]);
    createdRequests.push(request);

    await createAuditRecord({
      requestId: request.id,
      actorUserId: input.requestedByUserId,
      action: 'assessment_request_sent',
      details: {
        assessorUserId,
        assessmentType: input.assessmentType,
        deadlineAt: input.deadlineAt,
      },
    });
  }

  await syncOutcomeAssessmentEntriesForStudy(input.studyId);
  return createdRequests;
};

export const respondToOutcomeAssessmentRequest = async (input: {
  requestId: string;
  assessorUserId: string;
  action: 'accept' | 'reject';
}) => {
  const nextStatus: AssessmentRequestStatus = input.action === 'accept' ? 'accepted' : 'rejected';
  const acceptedAt = input.action === 'accept' ? 'NOW()' : 'NULL';
  const rejectedAt = input.action === 'reject' ? 'NOW()' : 'NULL';

  const result = await query<AssessmentRequestRow>(
    `
      UPDATE study_outcome_assessment_requests
      SET
        request_status = $1,
        accepted_at = ${acceptedAt},
        rejected_at = ${rejectedAt},
        updated_at = NOW()
      WHERE id = $2
        AND assessor_user_id = $3
        AND request_status = 'new'
      RETURNING
        study_outcome_assessment_requests.id,
        study_outcome_assessment_requests.study_id,
        (SELECT title FROM studies WHERE studies.id = study_outcome_assessment_requests.study_id) AS study_title,
        (SELECT study_type FROM studies WHERE studies.id = study_outcome_assessment_requests.study_id) AS study_type,
        study_outcome_assessment_requests.assessor_user_id,
        (SELECT full_name FROM users WHERE users.id = study_outcome_assessment_requests.assessor_user_id) AS assessor_name,
        (SELECT academic_id FROM users WHERE users.id = study_outcome_assessment_requests.assessor_user_id) AS assessor_academic_id,
        study_outcome_assessment_requests.requested_by_user_id,
        (SELECT full_name FROM users WHERE users.id = study_outcome_assessment_requests.requested_by_user_id) AS requested_by_name,
        study_outcome_assessment_requests.request_status,
        study_outcome_assessment_requests.assessment_type,
        study_outcome_assessment_requests.deadline_at,
        study_outcome_assessment_requests.samples_required,
        0::BIGINT AS samples_submitted,
        study_outcome_assessment_requests.optional_message,
        study_outcome_assessment_requests.created_at,
        study_outcome_assessment_requests.accepted_at,
        study_outcome_assessment_requests.completed_at
    `,
    [nextStatus, input.requestId, input.assessorUserId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  await createAuditRecord({
    requestId: input.requestId,
    actorUserId: input.assessorUserId,
    action: input.action === 'accept' ? 'assessment_request_accepted' : 'assessment_request_rejected',
  });

  return mapRequestRow(row);
};

export const getOutcomeAssessmentTemplateVersions = async (studyId: string) => {
  try {
    const result = await query<AssessmentTemplateVersionRow>(
      `
        SELECT
          versions.*,
          creator.full_name AS created_by_name,
          approver.full_name AS approved_by_name
        FROM study_outcome_assessment_template_versions AS versions
        JOIN users AS creator ON creator.id = versions.created_by_user_id
        LEFT JOIN users AS approver ON approver.id = versions.approved_by_user_id
        WHERE versions.study_id = $1
        ORDER BY versions.version_number DESC, versions.created_at DESC
      `,
      [studyId],
    );

    return result.rows.map(mapTemplateVersionRow);
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return [];
  }
};

export const proposeOutcomeAssessmentTemplateVersion = async (input: {
  studyId: string;
  requestId: string;
  createdByUserId: string;
  template: AssessmentTemplateField[];
  changeNotes?: string;
}) => {
  const latestVersionResult = await query<{ next_version: string | number }>(
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM study_outcome_assessment_template_versions
      WHERE study_id = $1
    `,
    [input.studyId],
  );

  const nextVersion = Number(latestVersionResult.rows[0]?.next_version ?? 1);

  const created = await query<AssessmentTemplateVersionRow>(
    `
      INSERT INTO study_outcome_assessment_template_versions (
        study_id,
        version_number,
        created_by_user_id,
        approval_status,
        template_json,
        change_notes,
        updated_at
      )
      VALUES ($1, $2, $3, 'pending_approval', $4::jsonb, $5, NOW())
      RETURNING
        *,
        NULL::TEXT AS created_by_name,
        NULL::TEXT AS approved_by_name
    `,
    [input.studyId, nextVersion, input.createdByUserId, JSON.stringify(input.template), input.changeNotes?.trim() || null],
  );

  await createAuditRecord({
    requestId: input.requestId,
    actorUserId: input.createdByUserId,
    action: 'assessment_template_proposed',
    details: {
      versionNumber: nextVersion,
    },
  });

  return mapTemplateVersionRow(created.rows[0]);
};

export const createResearcherAssessmentTemplateVersion = async (input: {
  studyId: string;
  createdByUserId: string;
  template: AssessmentTemplateField[];
  changeNotes?: string;
}) => {
  const latestVersionResult = await query<{ next_version: string | number }>(
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM study_outcome_assessment_template_versions
      WHERE study_id = $1
    `,
    [input.studyId],
  );

  const nextVersion = Number(latestVersionResult.rows[0]?.next_version ?? 1);

  const created = await query<AssessmentTemplateVersionRow>(
    `
      INSERT INTO study_outcome_assessment_template_versions (
        study_id,
        version_number,
        created_by_user_id,
        approval_status,
        template_json,
        change_notes,
        approved_by_user_id,
        approved_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'approved', $4::jsonb, $5, $3, NOW(), NOW())
      RETURNING
        *,
        NULL::TEXT AS created_by_name,
        NULL::TEXT AS approved_by_name
    `,
    [input.studyId, nextVersion, input.createdByUserId, JSON.stringify(input.template), input.changeNotes?.trim() || null],
  );

  await query(
    `
      UPDATE study_outcome_assessment_entries
      SET template_version_id = $1, updated_at = NOW()
      WHERE request_id IN (
        SELECT id
        FROM study_outcome_assessment_requests
        WHERE study_id = $2
          AND request_status IN ('accepted', 'active')
      )
        AND status NOT IN ('submitted', 'locked')
    `,
    [created.rows[0].id, input.studyId],
  );

  await createAuditRecord({
    actorUserId: input.createdByUserId,
    action: 'assessment_template_researcher_published',
    details: {
      studyId: input.studyId,
      versionNumber: nextVersion,
    },
  });

  return mapTemplateVersionRow(created.rows[0]);
};

export const approveOutcomeAssessmentTemplateVersion = async (input: {
  studyId: string;
  versionId: string;
  approvedByUserId: string;
}) => {
  const approved = await query<AssessmentTemplateVersionRow>(
    `
      UPDATE study_outcome_assessment_template_versions
      SET
        approval_status = 'approved',
        approved_by_user_id = $1,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
        AND study_id = $3
      RETURNING
        *,
        NULL::TEXT AS created_by_name,
        NULL::TEXT AS approved_by_name
    `,
    [input.approvedByUserId, input.versionId, input.studyId],
  );

  const row = approved.rows[0];
  if (!row) {
    return null;
  }

  await query(
    `
      UPDATE study_outcome_assessment_entries
      SET template_version_id = $1, updated_at = NOW()
      WHERE request_id IN (
        SELECT id
        FROM study_outcome_assessment_requests
        WHERE study_id = $2
          AND request_status IN ('accepted', 'active')
      )
        AND status NOT IN ('submitted', 'locked')
    `,
    [input.versionId, input.studyId],
  );

  await createAuditRecord({
    actorUserId: input.approvedByUserId,
    action: 'assessment_template_approved',
    details: {
      studyId: input.studyId,
      versionId: input.versionId,
    },
  });

  return mapTemplateVersionRow(row);
};

export const listOutcomeAssessmentEntriesForRequest = async (requestId: string) => {
  try {
    const result = await query<AssessmentEntryRow>(
      `
        SELECT *
        FROM study_outcome_assessment_entries
        WHERE request_id = $1
        ORDER BY created_at ASC
      `,
      [requestId],
    );

    return result.rows.map(mapEntryRow);
  } catch (error) {
    if (!isDatabaseUnavailable(error, requestId)) {
      throw error;
    }
    return [];
  }
};

export const updateOutcomeAssessmentEntry = async (input: {
  entryId: string;
  assessorUserId: string;
  response: Record<string, unknown>;
  assessorComments?: string;
  submit?: boolean;
}) => {
  const nextStatus: AssessmentEntryStatus = input.submit ? 'locked' : 'in_progress';

  const result = await query<AssessmentEntryRow>(
    `
      UPDATE study_outcome_assessment_entries
      SET
        response_json = $1::jsonb,
        assessor_comments = $2,
        status = $3,
        submitted_at = CASE WHEN $4 THEN NOW() ELSE submitted_at END,
        locked_at = CASE WHEN $4 THEN NOW() ELSE locked_at END,
        updated_at = NOW()
      WHERE id = $5
        AND assessor_user_id = $6
        AND status NOT IN ('locked')
      RETURNING *
    `,
    [
      JSON.stringify(input.response ?? {}),
      input.assessorComments?.trim() || null,
      nextStatus,
      Boolean(input.submit),
      input.entryId,
      input.assessorUserId,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const entry = mapEntryRow(row);

  const requestInfo = await query<{ request_id: string | number; sample_id: string | number; study_id: string | number }>(
    `
      SELECT
        entries.request_id,
        entries.sample_id,
        requests.study_id
      FROM study_outcome_assessment_entries AS entries
      JOIN study_outcome_assessment_requests AS requests ON requests.id = entries.request_id
      WHERE entries.id = $1
    `,
    [input.entryId],
  );

  const requestRow = requestInfo.rows[0];
  if (requestRow) {
    await updateRequestProgress(String(requestRow.request_id));
    await updateSampleProgressForStudy(String(requestRow.study_id));

    await createAuditRecord({
      requestId: requestRow.request_id,
      sampleId: requestRow.sample_id,
      entryId: input.entryId,
      actorUserId: input.assessorUserId,
      action: input.submit ? 'assessment_submitted' : 'assessment_saved',
    });
  }

  return entry;
};

export const listOutcomeAssessmentNotes = async (requestId: string, sampleId?: string) => {
  try {
    const result = await query<AssessmentNoteRow>(
      `
        SELECT
          notes.*,
          author.full_name AS author_name
        FROM study_outcome_assessment_notes AS notes
        JOIN users AS author ON author.id = notes.author_user_id
        WHERE notes.request_id = $1
          AND ($2::bigint IS NULL OR notes.sample_id = $2::bigint)
        ORDER BY notes.created_at ASC
      `,
      [requestId, sampleId ?? null],
    );

    return result.rows.map(mapNoteRow);
  } catch (error) {
    if (!isDatabaseUnavailable(error, requestId)) {
      throw error;
    }
    return [];
  }
};

export const createOutcomeAssessmentNote = async (input: {
  requestId: string;
  authorUserId: string;
  message: string;
  recipientScope?: AssessmentRecipientScope;
  sampleId?: string;
}) => {
  try {
    const result = await query<AssessmentNoteRow>(
      `
        INSERT INTO study_outcome_assessment_notes (
          request_id,
          sample_id,
          author_user_id,
          recipient_scope,
          message
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          *,
          NULL::TEXT AS author_name
      `,
      [input.requestId, input.sampleId ?? null, input.authorUserId, input.recipientScope ?? 'research_team', input.message.trim()],
    );

    const note = mapNoteRow(result.rows[0]);

    await createAuditRecord({
      requestId: input.requestId,
      sampleId: input.sampleId,
      actorUserId: input.authorUserId,
      action: 'assessment_note_created',
    });

    return note;
  } catch (error) {
    if (!isDatabaseUnavailable(error, input.requestId)) {
      throw error;
    }
    const now = new Date().toISOString();
    return {
      id: createLocalId('dev_note'),
      requestId: input.requestId,
      sampleId: input.sampleId,
      authorUserId: input.authorUserId,
      recipientScope: input.recipientScope ?? 'research_team',
      message: input.message.trim(),
      createdAt: now,
    } satisfies AssessmentNoteSummary;
  }
};

export const getOutcomeAssessmentWorkspace = async (requestId: string, assessorUserId: string) => {
  try {
    const requestResult = await query<AssessmentRequestRow>(
      `
        SELECT
          requests.id,
          requests.study_id,
          studies.title AS study_title,
          studies.study_type,
          requests.assessor_user_id,
          assessor.full_name AS assessor_name,
          assessor.academic_id AS assessor_academic_id,
          requests.requested_by_user_id,
          requester.full_name AS requested_by_name,
          requests.request_status,
          requests.assessment_type,
          requests.deadline_at,
          requests.samples_required,
          COUNT(entries.id) FILTER (WHERE entries.status IN ('submitted', 'locked'))::BIGINT AS samples_submitted,
          requests.optional_message,
          requests.created_at,
          requests.accepted_at,
          requests.completed_at
        FROM study_outcome_assessment_requests AS requests
        JOIN studies ON studies.id = requests.study_id
        JOIN users AS assessor ON assessor.id = requests.assessor_user_id
        JOIN users AS requester ON requester.id = requests.requested_by_user_id
        LEFT JOIN study_outcome_assessment_entries AS entries ON entries.request_id = requests.id
        WHERE requests.id = $1
          AND requests.assessor_user_id = $2
        GROUP BY requests.id, studies.id, assessor.id, requester.id
        LIMIT 1
      `,
      [requestId, assessorUserId],
    );

    const request = requestResult.rows[0] ? mapRequestRow(requestResult.rows[0]) : null;
    if (!request) {
      return null;
    }

    const [samples, entries, templateVersions, notes] = await Promise.all([
      listOutcomeAssessmentSamplesForAssessor(request.studyId),
      listOutcomeAssessmentEntriesForRequest(requestId),
      getOutcomeAssessmentTemplateVersions(request.studyId),
      listOutcomeAssessmentNotes(requestId),
    ]);

    return {
      request,
      samples,
      entries,
      templateVersions,
      approvedTemplate: templateVersions.find((item) => item.approvalStatus === 'approved'),
      notes,
    };
  } catch (error) {
    if (!isDatabaseUnavailable(error, requestId)) {
      throw error;
    }
    return null;
  }
};

export const hasOutcomeAssessmentAccess = async (studyId: string, assessorUserId: string) => {
  try {
    const result = await query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM study_outcome_assessment_requests
          WHERE study_id = $1
            AND assessor_user_id = $2
            AND request_status IN ('new', 'accepted', 'active', 'completed')
        ) AS exists
      `,
      [studyId, assessorUserId],
    );

    return Boolean(result.rows[0]?.exists);
  } catch (error) {
    if (!isDatabaseUnavailable(error, studyId)) {
      throw error;
    }
    return false;
  }
};
