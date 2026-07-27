import { Response } from 'express';
import fs from 'node:fs/promises';
import { query } from '../db.js';
import type { AuthRequest } from '../middleware/auth.js';
import { findStudyByIdForSupervisor, findStudyByIdForUser } from '../models/Study.js';
import { listStudyAnalyses, listStudyFiles, type StudyFileRecord } from '../models/StudyAsset.js';
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
import { resolveStoredPath } from '../lib/storage.js';

const analyticsBaseUrl = (process.env.PYTHON_ANALYTICS_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
const analyticsTimeoutMs = Number(process.env.PYTHON_ANALYTICS_TIMEOUT_MS ?? 120000);

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

const getErrorPayload = async (response: globalThis.Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return { detail: await response.text() };
};

const postJsonToAnalytics = async (endpoint: string, payload: Record<string, unknown>) => {
  const response = await fetch(`${analyticsBaseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(analyticsTimeoutMs),
  });

  if (!response.ok) {
    const data = await getErrorPayload(response);
    throw new Error(data.detail || data.message || 'Analytics request failed');
  }

  return response.json();
};

const postFileToAnalytics = async (endpoint: string, file: StudyFileRecord, buffer: Buffer) => {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: file.mimeType || 'application/octet-stream' }),
    file.originalName,
  );

  const response = await fetch(`${analyticsBaseUrl}${endpoint}`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(analyticsTimeoutMs),
  });

  if (!response.ok) {
    const data = await getErrorPayload(response);
    throw new Error(data.detail || data.message || 'Document extraction failed');
  }

  return response.json() as Promise<{
    documentReady: boolean;
    message: string;
    text: string;
    format: string;
    metadata?: Record<string, unknown>;
  }>;
};

const normalizeStudyType = (value: unknown) => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return 'rct';
  }
  if (normalized.includes('rct') || normalized.includes('random')) {
    return 'rct';
  }
  if (normalized.includes('prospective') || normalized.includes('cohort')) {
    return 'prospective';
  }
  if (normalized.includes('retrospective') || normalized.includes('record') || normalized.includes('ehr')) {
    return 'retrospective';
  }
  if (normalized.includes('cross') || normalized.includes('sectional') || normalized.includes('survey')) {
    return 'cross_sectional';
  }
  if (normalized.includes('vitro') || normalized.includes('lab')) {
    return 'in_vitro';
  }
  return ['rct', 'prospective', 'retrospective', 'cross_sectional', 'in_vitro'].includes(normalized)
    ? normalized
    : 'rct';
};

const isProposalLikeFile = (file: StudyFileRecord) => {
  const name = file.originalName.toLowerCase();
  const mime = (file.mimeType ?? '').toLowerCase();
  return (
    file.fileCategory === 'protocol' ||
    file.fileCategory === 'report' ||
    file.fileCategory === 'attachment' ||
    name.endsWith('.pdf') ||
    name.endsWith('.docx') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.startsWith('text/')
  );
};

const extractTextFromStudyFile = async (file: StudyFileRecord) => {
  try {
    const buffer = await fs.readFile(resolveStoredPath(file.relativePath));
    const extraction = await postFileToAnalytics('/document/extract-text', file, buffer);
    return {
      fileId: file.id,
      originalName: file.originalName,
      fileCategory: file.fileCategory,
      ready: extraction.documentReady,
      message: extraction.message,
      format: extraction.format,
      text: extraction.text?.slice(0, 18000) ?? '',
    };
  } catch (error) {
    return {
      fileId: file.id,
      originalName: file.originalName,
      fileCategory: file.fileCategory,
      ready: false,
      message: error instanceof Error ? error.message : 'Unable to extract document text',
      format: 'unknown',
      text: '',
    };
  }
};

const getAssistantAnalysisSnippet = (analysis: Awaited<ReturnType<typeof listStudyAnalyses>>[number]) => {
  const assistantAnswer =
    analysis.assistant && typeof analysis.assistant.answer === 'string'
      ? analysis.assistant.answer
      : undefined;
  const extractedElements =
    analysis.assistant && typeof analysis.assistant.extractedStudyElements === 'object'
      ? JSON.stringify(analysis.assistant.extractedStudyElements)
      : undefined;
  const resultSummary =
    analysis.result && typeof analysis.result.summaryText === 'string'
      ? analysis.result.summaryText
      : undefined;

  return [analysis.title, analysis.analysisType, analysis.prompt, assistantAnswer, extractedElements, resultSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000);
};

const buildAiDraftProtocolText = (input: {
  study: NonNullable<Awaited<ReturnType<typeof getManagedStudy>>>;
  extractedDocuments: Array<Awaited<ReturnType<typeof extractTextFromStudyFile>>>;
  analyses: Awaited<ReturnType<typeof listStudyAnalyses>>;
}) => {
  const { study, extractedDocuments, analyses } = input;
  const sections = [
    `Study title: ${study.title}`,
    study.description ? `Description: ${study.description}` : '',
    `Study type: ${study.studyType}`,
    `Target sample size: ${study.targetSampleSize}`,
    `Randomization: ${study.hasRandomization ? 'yes' : 'no'}`,
    study.randomizationMethod ? `Randomization method: ${study.randomizationMethod}` : '',
    `Blinding: ${study.hasBlinding ? 'yes' : 'no'}`,
    study.groups?.length ? `Study groups: ${study.groups.join(', ')}` : '',
    study.ethicsApprovalNumber ? `Ethics approval: ${study.ethicsApprovalNumber}` : '',
    study.clinicalRegistrationNumber ? `Trial registration: ${study.clinicalRegistrationNumber}` : '',
    study.blindingSettings ? `Blinding settings: ${JSON.stringify(study.blindingSettings)}` : '',
  ].filter(Boolean);

  for (const document of extractedDocuments) {
    if (document.text.trim()) {
      sections.push(`\nSource document: ${document.originalName}\n${document.text}`);
    } else {
      sections.push(`\nSource document: ${document.originalName}\nText extraction unavailable: ${document.message}`);
    }
  }

  const analysisSnippets = analyses
    .map(getAssistantAnalysisSnippet)
    .filter(Boolean)
    .slice(0, 3);
  if (analysisSnippets.length) {
    sections.push(`\nPrevious AI/analysis outputs:\n${analysisSnippets.join('\n\n---\n\n')}`);
  }

  return sections.join('\n').slice(0, 60000);
};

const buildCrfGenerationPrompt = (studyType: string) =>
  [
    'Generate a clinical dental assessment form / CRF based on this research proposal and the authorized knowledge base.',
    `Study design route: ${studyType}.`,
    'Apply three layers: Layer 1 Extraction for the 23 proposal sections, Layer 2 Validation, Layer 3 Missing Information.',
    'The final fields must be practical for patient screening, clinical examination, outcome measurement, follow-up, reliability, safety, and assessor comments.',
    'Return a strict JSON object with extracted_summary, extraction, validation, missing_information, and fields.',
  ].join('\n');

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

export const generateOutcomeAssessmentTemplateDraftRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await getManagedStudy(req, res, studyId);
  if (!study) {
    return;
  }
  if (!ensureUnlockedManagedStudy(study, res)) {
    return;
  }

  try {
    const [files, analyses] = await Promise.all([
      listStudyFiles(studyId),
      listStudyAnalyses(studyId),
    ]);
    const proposalFiles = files.filter(isProposalLikeFile).slice(0, 5);
    const extractedDocuments = await Promise.all(proposalFiles.map(extractTextFromStudyFile));
    const studyType = normalizeStudyType(study.studyType);
    const protocolText = buildAiDraftProtocolText({
      study,
      extractedDocuments,
      analyses,
    });
    const prompt = buildCrfGenerationPrompt(studyType);

    let knowledgePayload: Record<string, unknown> | null = null;
    try {
      knowledgePayload = (await postJsonToAnalytics('/api/v1/query', {
        question: `${prompt}\n\n${protocolText.slice(0, 5000)}`,
        study_type: studyType,
        limit: 8,
      })) as Record<string, unknown>;
    } catch (error) {
      knowledgePayload = {
        answer: '',
        citations: [],
        error: error instanceof Error ? error.message : 'Unable to query knowledge base',
      };
    }

    const assistantPayload = (await postJsonToAnalytics('/assistant/chat', {
      mode: 'crf_generation',
      prompt,
      protocol_text: protocolText,
      study_type: studyType,
      study_context: {
        study_metadata: {
          id: study.id,
          title: study.title,
          description: study.description,
          studyType: study.studyType,
          normalizedStudyType: studyType,
          targetSampleSize: study.targetSampleSize,
          hasRandomization: study.hasRandomization,
          hasBlinding: study.hasBlinding,
          randomizationMethod: study.randomizationMethod,
          groups: study.groups,
          blindingSettings: study.blindingSettings,
          ethicsApprovalNumber: study.ethicsApprovalNumber,
          clinicalRegistrationNumber: study.clinicalRegistrationNumber,
        },
        retrieved_resources: {
          files: files.slice(0, 20).map((file) => ({
            id: file.id,
            originalName: file.originalName,
            fileCategory: file.fileCategory,
          })),
          analyses: analyses.slice(0, 10).map((analysis) => ({
            id: analysis.id,
            title: analysis.title,
            analysisType: analysis.analysisType,
            createdAt: analysis.createdAt,
          })),
        },
        knowledge_context: knowledgePayload,
      },
    })) as Record<string, unknown>;

    return res.json({
      ...assistantPayload,
      knowledge: knowledgePayload,
      sourceDocuments: extractedDocuments.map((document) => ({
        fileId: document.fileId,
        originalName: document.originalName,
        fileCategory: document.fileCategory,
        ready: document.ready,
        message: document.message,
        format: document.format,
        extractedCharacters: document.text.length,
      })),
      protocolCharactersUsed: protocolText.length,
    });
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : 'Unable to generate an AI assessment form draft',
    });
  }
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
