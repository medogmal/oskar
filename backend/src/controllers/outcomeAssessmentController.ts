import { Response } from 'express';
import { query } from '../db.js';
import type { AuthRequest } from '../middleware/auth.js';
import { findStudyByIdForSupervisor, findStudyByIdForUser } from '../models/Study.js';
import {
  approveOutcomeAssessmentTemplateVersion,
  createOutcomeAssessmentNote,
  createResearcherAssessmentTemplateVersion,
  createOutcomeAssessmentRequests,
  ensureStudyAssessmentTemplate,
  getOutcomeAssessmentTemplateVersions,
  getOutcomeAssessmentWorkspace,
  listOutcomeAssessmentNotes,
  listOutcomeAssessmentRequestsForAssessor,
  listOutcomeAssessmentRequestsForStudy,
  listOutcomeAssessmentSamplesForStudy,
  proposeOutcomeAssessmentTemplateVersion,
  respondToOutcomeAssessmentRequest,
  syncOutcomeAssessmentEntriesForStudy,
  updateOutcomeAssessmentEntry,
  upsertOutcomeAssessmentSamples,
  type AssessmentTemplateField,
} from '../models/OutcomeAssessment.js';
import { findUserByIdAndAccountType } from '../models/User.js';

const ensureStudyManagerAccount = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (!['student', 'co_researcher', 'supervisor', 'assistant_supervisor'].includes(req.user.accountType)) {
    res.status(403).json({ message: 'Only researchers and supervisors can manage outcome assessments' });
    return false;
  }

  return true;
};

const ensureAssessorAccount = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (req.user.accountType !== 'clinical_evaluator') {
    res.status(403).json({ message: 'Only assessor accounts can access this module' });
    return false;
  }

  return true;
};

const getManagedStudy = async (req: AuthRequest, res: Response, studyId: string) => {
  if (!ensureStudyManagerAccount(req, res)) {
    return null;
  }

  const user = req.user!;

  if (user.accountType === 'student' || user.accountType === 'co_researcher') {
    const study = await findStudyByIdForUser(user.id, studyId);
    if (!study) {
      res.status(404).json({ message: 'Study not found' });
      return null;
    }
    return study;
  }

  const study = await findStudyByIdForSupervisor(studyId);
  if (!study) {
    res.status(404).json({ message: 'Study not found' });
    return null;
  }

  const isAssignedSupervisor =
    (user.accountType === 'supervisor' && study.supervisorUserId === user.id) ||
    (user.accountType === 'assistant_supervisor' && study.assistantSupervisorUserId === user.id);

  if (!isAssignedSupervisor) {
    res.status(403).json({ message: 'You are not assigned to this study' });
    return null;
  }

  return study;
};

const ensureUnlockedManagedStudy = (
  study: Awaited<ReturnType<typeof getManagedStudy>>,
  res: Response,
) => {
  if (study?.isLocked) {
    res.status(409).json({ message: 'Study is locked for external evaluation and outcome assessment setup is read-only' });
    return false;
  }

  return true;
};

const ensureStudyFilesBelongToStudy = async (
  studyId: string,
  assetLinks: Array<{ fileId: string }>,
) => {
  if (assetLinks.length === 0) {
    return true;
  }

  const result = await query<{ id: string | number }>(
    `
      SELECT id
      FROM study_files
      WHERE study_id = $1
        AND id = ANY($2::bigint[])
    `,
    [studyId, assetLinks.map((item) => item.fileId)],
  );

  return result.rows.length === assetLinks.length;
};

export const getOutcomeAssessmentOverviewRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }

  await ensureStudyAssessmentTemplate(studyId, req.user!.id, study.studyType);
  await syncOutcomeAssessmentEntriesForStudy(studyId);

  const [requests, samples, templateVersions] = await Promise.all([
    listOutcomeAssessmentRequestsForStudy(studyId),
    listOutcomeAssessmentSamplesForStudy(studyId),
    getOutcomeAssessmentTemplateVersions(studyId),
  ]);

  return res.json({
    study,
    requests,
    samples,
    templateVersions,
    approvedTemplate: templateVersions.find((item) => item.approvalStatus === 'approved') ?? null,
  });
};

export const createOutcomeAssessmentRequestsRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }
  if (!ensureUnlockedManagedStudy(study, res)) {
    return;
  }

  const rawAssessorUserIds = Array.isArray(req.body.assessorUserIds) ? (req.body.assessorUserIds as unknown[]) : [];
  const assessorUserIds = Array.from(new Set(rawAssessorUserIds.map((item: unknown) => String(item).trim()).filter(Boolean)));

  for (const assessorUserId of assessorUserIds) {
    const assessor = await findUserByIdAndAccountType(assessorUserId, 'clinical_evaluator');
    if (!assessor) {
      return res.status(400).json({ message: 'Selected assessor account is invalid' });
    }
  }

  const requests = await createOutcomeAssessmentRequests({
    studyId,
    studyType: study.studyType,
    assessorUserIds,
    requestedByUserId: req.user!.id,
    assessmentType: String(req.body.assessmentType ?? ''),
    deadlineAt: typeof req.body.deadlineAt === 'string' && req.body.deadlineAt.trim() ? req.body.deadlineAt : undefined,
    samplesRequired: Number(req.body.samplesRequired || 0),
    optionalMessage: typeof req.body.optionalMessage === 'string' ? req.body.optionalMessage : undefined,
  });

  return res.status(201).json(requests);
};

export const upsertOutcomeAssessmentSamplesRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }
  if (!ensureUnlockedManagedStudy(study, res)) {
    return;
  }

  const rawSamples = Array.isArray(req.body.samples) ? (req.body.samples as Array<Record<string, unknown>>) : [];
  const samples = rawSamples.map((sample) => ({
    subjectId: String(sample.subjectId ?? '').trim(),
    visitNumber: String(sample.visitNumber ?? '').trim(),
    inclusionEligible: sample.inclusionEligible !== false,
    assetLinks: Array.isArray(sample.assetLinks)
      ? sample.assetLinks.map((asset) => {
          const typedAsset = asset as Record<string, unknown>;
          return {
            fileId: String(typedAsset.fileId ?? '').trim(),
            assetType: typedAsset.assetType as
              | 'photo_before'
              | 'photo_after'
              | 'xray_before'
              | 'xray_after'
              | 'stl'
              | 'lab_result'
              | 'other',
          };
        })
      : [],
  }));

  for (const sample of samples) {
    if (!(await ensureStudyFilesBelongToStudy(studyId, sample.assetLinks))) {
      return res.status(400).json({ message: 'One or more linked sample files do not belong to this study' });
    }
  }

  const result = await upsertOutcomeAssessmentSamples(studyId, req.user!.id, samples);
  return res.status(201).json(result);
};

export const approveOutcomeAssessmentTemplateVersionRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }

  const versionId = Array.isArray(req.params.versionId) ? req.params.versionId[0] : req.params.versionId;
  const version = await approveOutcomeAssessmentTemplateVersion({
    studyId,
    versionId,
    approvedByUserId: req.user!.id,
  });

  if (!version) {
    return res.status(404).json({ message: 'Template version not found' });
  }

  return res.json(version);
};

export const createResearcherAssessmentTemplateVersionRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }
  if (!ensureUnlockedManagedStudy(study, res)) {
    return;
  }

  const version = await createResearcherAssessmentTemplateVersion({
    studyId,
    createdByUserId: req.user!.id,
    template: req.body.template as AssessmentTemplateField[],
    changeNotes: typeof req.body.changeNotes === 'string' ? req.body.changeNotes : undefined,
  });

  return res.status(201).json(version);
};

export const listOutcomeAssessmentRequestsForAssessorRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const requests = await listOutcomeAssessmentRequestsForAssessor(req.user!.id);
  return res.json(requests);
};

export const respondToOutcomeAssessmentRequestRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  const responsePayload = await respondToOutcomeAssessmentRequest({
    requestId,
    assessorUserId: req.user!.id,
    action: req.body.action,
  });

  if (!responsePayload) {
    return res.status(404).json({ message: 'Assessment request not found or cannot be updated' });
  }

  return res.json(responsePayload);
};

export const getOutcomeAssessmentWorkspaceRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  const workspace = await getOutcomeAssessmentWorkspace(requestId, req.user!.id);

  if (!workspace) {
    return res.status(404).json({ message: 'Assessment request workspace not found' });
  }

  return res.json(workspace);
};

export const proposeOutcomeAssessmentTemplateRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  const workspace = await getOutcomeAssessmentWorkspace(requestId, req.user!.id);
  if (!workspace) {
    return res.status(404).json({ message: 'Assessment request workspace not found' });
  }

  const templateVersion = await proposeOutcomeAssessmentTemplateVersion({
    studyId: workspace.request.studyId,
    requestId,
    createdByUserId: req.user!.id,
    template: req.body.template as AssessmentTemplateField[],
    changeNotes: req.body.changeNotes,
  });

  return res.status(201).json(templateVersion);
};

export const saveOutcomeAssessmentEntryRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const entryId = Array.isArray(req.params.entryId) ? req.params.entryId[0] : req.params.entryId;
  const entry = await updateOutcomeAssessmentEntry({
    entryId,
    assessorUserId: req.user!.id,
    response: req.body.response,
    assessorComments: req.body.assessorComments,
    submit: false,
  });

  if (!entry) {
    return res.status(404).json({ message: 'Assessment entry not found or already locked' });
  }

  return res.json(entry);
};

export const submitOutcomeAssessmentEntryRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureAssessorAccount(req, res)) {
    return;
  }

  const entryId = Array.isArray(req.params.entryId) ? req.params.entryId[0] : req.params.entryId;
  const entry = await updateOutcomeAssessmentEntry({
    entryId,
    assessorUserId: req.user!.id,
    response: req.body.response,
    assessorComments: req.body.assessorComments,
    submit: true,
  });

  if (!entry) {
    return res.status(404).json({ message: 'Assessment entry not found or already locked' });
  }

  return res.json(entry);
};

export const listOutcomeAssessmentNotesRecord = async (req: AuthRequest, res: Response) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

  if (req.user?.accountType === 'clinical_evaluator') {
    const workspace = await getOutcomeAssessmentWorkspace(requestId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ message: 'Assessment request not found' });
    }
  } else {
    const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const study = await getManagedStudy(req, res, studyId);
    if (!study) {
      return;
    }

    const requests = await listOutcomeAssessmentRequestsForStudy(studyId);
    if (!requests.some((item) => item.id === requestId)) {
      return res.status(404).json({ message: 'Assessment request not found' });
    }
  }

  const notes = await listOutcomeAssessmentNotes(
    requestId,
    typeof req.query.sampleId === 'string' && req.query.sampleId.trim() ? req.query.sampleId : undefined,
  );

  return res.json(notes);
};

export const createOutcomeAssessmentNoteRecord = async (req: AuthRequest, res: Response) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

  if (req.user?.accountType === 'clinical_evaluator') {
    const workspace = await getOutcomeAssessmentWorkspace(requestId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ message: 'Assessment request not found' });
    }
  } else {
    const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const study = await getManagedStudy(req, res, studyId);
    if (!study) {
      return;
    }

    const requests = await listOutcomeAssessmentRequestsForStudy(studyId);
    if (!requests.some((item) => item.id === requestId)) {
      return res.status(404).json({ message: 'Assessment request not found' });
    }
  }

  const note = await createOutcomeAssessmentNote({
    requestId,
    authorUserId: req.user!.id,
    message: req.body.message,
    recipientScope: req.body.recipientScope,
    sampleId: typeof req.body.sampleId === 'string' && req.body.sampleId.trim() ? req.body.sampleId : undefined,
  });

  return res.status(201).json(note);
};
