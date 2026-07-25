import fs from 'node:fs/promises';
import path from 'node:path';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import * as XLSX from 'xlsx';
import type { AuthRequest } from '../middleware/auth.js';
import { buildGroupMaskMap } from '../lib/studyDesign.js';
import { findStudyByIdForSupervisor, findStudyByIdForUser } from '../models/Study.js';
import { hasOutcomeAssessmentAccess, listOutcomeAssessmentSamplesForStudy } from '../models/OutcomeAssessment.js';
import {
  createStudyAnalysisRecord,
  createStudyFileRecord,
  getStudyAnalysisById,
  getStudyFileById,
  listStudyAnalyses,
  listStudyFiles,
  updateStudyAnalysisReportPath,
  type StudyFileCategory,
} from '../models/StudyAsset.js';
import { resolveStoredPath, saveBufferToStudyBucket } from '../lib/storage.js';

const analyticsBaseUrl = (process.env.PYTHON_ANALYTICS_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
const analyticsTimeoutMs = Number(process.env.PYTHON_ANALYTICS_TIMEOUT_MS ?? 120000);

type MulterRequest = AuthRequest & {
  file?: Express.Multer.File;
};

const ensureStudyResourceUser = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (!['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator'].includes(req.user.accountType)) {
    res.status(403).json({ message: 'This account cannot access study resources' });
    return false;
  }

  return true;
};

const ensureAccessibleStudy = async (req: AuthRequest, res: Response) => {
  if (!ensureStudyResourceUser(req, res)) {
    return null;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

  const canAccess =
    (user.accountType === 'supervisor' && study.supervisorUserId === user.id) ||
    (user.accountType === 'assistant_supervisor' && study.assistantSupervisorUserId === user.id) ||
    (user.accountType === 'clinical_evaluator' && study.assignedClinicalEvaluatorUserId === user.id);

  const assessorAccess =
    user.accountType === 'clinical_evaluator' ? await hasOutcomeAssessmentAccess(studyId, user.id) : false;

  if (!canAccess && !assessorAccess) {
    res.status(403).json({ message: 'You are not assigned to this study' });
    return null;
  }

  return study;
};

const ensureStudyNotLocked = (study: Awaited<ReturnType<typeof ensureAccessibleStudy>>, res: Response) => {
  if (study?.isLocked) {
    res.status(409).json({ message: 'Study is locked for external evaluation and cannot be modified' });
    return false;
  }

  return true;
};

const parseJsonField = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const getErrorPayload = async (response: globalThis.Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return { detail: await response.text() };
};

const postMultipartToAnalytics = async (
  endpoint: string,
  file: Express.Multer.File,
  extraFields: Record<string, string>,
) => {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'application/octet-stream' }), file.originalname);

  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value);
  }

  const response = await fetch(`${analyticsBaseUrl}${endpoint}`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(analyticsTimeoutMs),
  });

  if (!response.ok) {
    const payload = await getErrorPayload(response);
    throw new Error(payload.detail || payload.message || 'Analytics request failed');
  }

  return response.json();
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
    throw new Error(data.detail || data.message || 'Assistant request failed');
  }

  return response.json();
};

const inferFileCategory = (file: Express.Multer.File, requestedCategory?: string): StudyFileCategory => {
  if (requestedCategory && ['protocol', 'dataset', 'image', 'attachment', 'report'].includes(requestedCategory)) {
    return requestedCategory as StudyFileCategory;
  }

  const mimeType = file.mimetype ?? '';
  const extension = path.extname(file.originalname).toLowerCase();

  if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
    return 'image';
  }

  if (['.csv', '.xlsx', '.xls', '.sav'].includes(extension)) {
    return 'dataset';
  }

  if (extension === '.pdf') {
    return 'protocol';
  }

  return 'attachment';
};

const sanitizePdfText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const containsNonAscii = (value: string) => /[^\x00-\x7F]/.test(value);

const getPdfNarrative = (value: unknown, fallback: string) => {
  const text = sanitizePdfText(value);
  if (!text) {
    return fallback;
  }

  if (containsNonAscii(text)) {
    return 'This section contains multilingual text. Review the web workspace for the full original narrative.';
  }

  return text;
};

const getObjectRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const getNumericValue = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const formatMetricValue = (value: unknown) => {
  const numericValue = getNumericValue(value);
  if (typeof numericValue === 'number') {
    return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(4);
  }

  const text = sanitizePdfText(value);
  return text || 'Not available';
};

const buildProfileSummaryLines = (profile?: Record<string, unknown>) => {
  if (!profile) {
    return [];
  }

  const rows = getNumericValue(profile.rows);
  const columns = getNumericValue(profile.columns);
  const numericColumns = Array.isArray(profile.numericColumns) ? profile.numericColumns.length : undefined;
  const categoricalColumns = Array.isArray(profile.categoricalColumns) ? profile.categoricalColumns.length : undefined;
  const missingValues = getObjectRecord(profile.missingValues);
  const missingFields = missingValues ? Object.keys(missingValues).length : 0;

  return [
    `Rows analysed: ${formatMetricValue(rows)}`,
    `Columns analysed: ${formatMetricValue(columns)}`,
    `Numeric variables: ${formatMetricValue(numericColumns)}`,
    `Categorical variables: ${formatMetricValue(categoricalColumns)}`,
    `Fields with missing values: ${formatMetricValue(missingFields)}`,
  ];
};

const buildFindingLines = (result?: Record<string, unknown>) => {
  if (!result) {
    return [];
  }

  const lines = [
    `Primary analysis: ${formatMetricValue(result.analysis)}`,
    `P-value: ${formatMetricValue(result.pValue)}`,
    `Test statistic: ${formatMetricValue(result.statistic)}`,
  ];

  const auc = getNumericValue(result.auc);
  if (typeof auc === 'number') {
    lines.push(`AUC: ${formatMetricValue(auc)}`);
  }

  const formula = sanitizePdfText(result.formula);
  if (formula) {
    lines.push(`Model formula: ${formula}`);
  }

  const recommended = getObjectRecord(result.recommended);
  if (recommended?.recommended_test) {
    lines.push(`Recommended method: ${formatMetricValue(recommended.recommended_test)}`);
  }

  const groupMeans = getObjectRecord(result.groupMeans);
  if (groupMeans && Object.keys(groupMeans).length > 0) {
    const summarizedMeans = Object.entries(groupMeans)
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${formatMetricValue(value)}`)
      .join(' | ');
    lines.push(`Group means: ${summarizedMeans}`);
  }

  return lines;
};

const getAssistantSummary = (assistant?: Record<string, unknown>) => {
  if (!assistant) {
    return 'No assistant interpretation was generated for this analysis.';
  }

  return getPdfNarrative(
    typeof assistant.answer === 'string' ? assistant.answer : undefined,
    'No assistant interpretation was generated for this analysis.',
  );
};

const getOcrSummary = (ocr?: Record<string, unknown>) => {
  if (!ocr) {
    return 'No OCR extraction was performed for this analysis.';
  }

  const message = sanitizePdfText(ocr.message);
  const text = getPdfNarrative(ocr.text, '');

  if (message && text) {
    return `${message} ${text}`;
  }

  return message || text || 'OCR extraction metadata is available in the workspace.';
};

const writeSectionHeading = (document: PDFKit.PDFDocument, title: string) => {
  document.moveDown();
  document.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(title);
  document.moveDown(0.35);
};

const writeParagraph = (document: PDFKit.PDFDocument, text: string) => {
  document.font('Helvetica').fontSize(10.5).fillColor('#334155').text(text, {
    lineGap: 3,
  });
};

const writeBulletLines = (document: PDFKit.PDFDocument, items: string[]) => {
  items
    .filter(Boolean)
    .forEach((item) => {
      writeParagraph(document, `- ${item}`);
    });
};

const drawReportHeader = (
  document: PDFKit.PDFDocument,
  input: {
    studyTitle: string;
    analysisTitle: string;
    analysisType?: string;
    generatedAt: string;
  },
) => {
  const startY = document.y;
  document.save().roundedRect(48, startY, 500, 92, 18).fill('#0f172a');
  document.restore();

  document.fillColor('#93c5fd').font('Helvetica-Bold').fontSize(10).text('CLINRESEARCH AI', 68, startY + 14);
  document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('Academic Statistical Report', 68, startY + 28);
  document
    .fillColor('#cbd5e1')
    .font('Helvetica')
    .fontSize(10)
    .text(
      `${sanitizePdfText(input.studyTitle) || 'Untitled study'} | ${sanitizePdfText(input.analysisTitle) || 'Untitled analysis'}`,
      68,
      startY + 56,
      { width: 420 },
    );
  document
    .fillColor('#e2e8f0')
    .font('Helvetica')
    .fontSize(9)
    .text(
      `Analysis type: ${sanitizePdfText(input.analysisType) || 'Not specified'} | Generated: ${sanitizePdfText(input.generatedAt) || 'Not available'}`,
      68,
      startY + 72,
      { width: 420 },
    );

  document.moveDown(5.5);
};

const buildWordBulletParagraphs = (items: string[]) =>
  items
    .filter(Boolean)
    .map(
      (item) =>
        new Paragraph({
          text: item,
          bullet: { level: 0 },
          spacing: { after: 120 },
        }),
    );

const buildWordParagraph = (text: string) =>
  new Paragraph({
    children: [new TextRun(text)],
    spacing: { after: 180 },
  });

const sanitizeFileBaseName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'report';

const escapeCsvValue = (value: string | number | boolean | null | undefined) => {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildReportIdentityLines = (input: {
  studyTitle: string;
  analysisTitle: string;
  analysisType?: string;
  principalInvestigatorName?: string;
  supervisorName?: string;
  assistantSupervisorName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  generatedAt: string;
}) =>
  [
    `Study title: ${sanitizePdfText(input.studyTitle) || 'Untitled study'}`,
    `Analysis title: ${sanitizePdfText(input.analysisTitle) || 'Untitled analysis'}`,
    `Principal investigator: ${sanitizePdfText(input.principalInvestigatorName) || 'Not assigned'}`,
    `Supervisor: ${sanitizePdfText(input.supervisorName) || sanitizePdfText(input.assistantSupervisorName) || 'Not assigned'}`,
    `Ethics approval: ${sanitizePdfText(input.ethicsApprovalNumber) || 'Not available'}`,
    `Clinical registration: ${sanitizePdfText(input.clinicalRegistrationNumber) || 'Not available'}`,
    `Generated at: ${sanitizePdfText(input.generatedAt) || 'Not available'}`,
    `Analysis type: ${sanitizePdfText(input.analysisType) || 'Not specified'}`,
  ];

const statisticianDatasetHeaders = [
  'subject_id',
  'visit_number',
  'inclusion_eligible',
  'group_assignment',
  'sample_status',
  'masked_group_code',
  'assets_count',
] as const;

type StatisticianDatasetRow = Record<(typeof statisticianDatasetHeaders)[number], string>;

const buildStatisticianDatasetRows = (
  study: {
    groups: string[];
    blindingSettings?: {
      permissions: {
        maskGroupsForStatistician: boolean;
      };
    };
  },
  samples: Awaited<ReturnType<typeof listOutcomeAssessmentSamplesForStudy>>,
): StatisticianDatasetRow[] => {
  const maskMap = buildGroupMaskMap(study.groups);
  const maskGroupsForStatistician = Boolean(study.blindingSettings?.permissions.maskGroupsForStatistician);

  return samples.map((sample) => {
    const codedGroup =
      sample.maskedGroupCode ||
      (sample.allocatedGroup ? maskMap[sample.allocatedGroup] ?? '' : '');

    return {
      subject_id: sample.subjectId,
      visit_number: sample.visitNumber,
      inclusion_eligible: sample.inclusionEligible ? 'true' : 'false',
      group_assignment: maskGroupsForStatistician ? codedGroup : sample.allocatedGroup ?? '',
      sample_status: sample.sampleStatus,
      masked_group_code: codedGroup,
      assets_count: String(sample.assets.length),
    };
  });
};

const generateStatisticianCsvContent = (rows: StatisticianDatasetRow[]) =>
  [
    statisticianDatasetHeaders.join(','),
    ...rows.map((row) => statisticianDatasetHeaders.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\r\n');

const generateStatisticianWorkbookBuffer = (input: {
  studyTitle: string;
  generatedAt: string;
  masked: boolean;
  rows: StatisticianDatasetRow[];
}) => {
  const workbook = XLSX.utils.book_new();
  const datasetSheet = XLSX.utils.json_to_sheet(input.rows);
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Study Title', input.studyTitle],
    ['Generated At', input.generatedAt],
    ['Statistician Blinding', input.masked ? 'Masked / coded' : 'Open labels'],
    ['Rows Exported', String(input.rows.length)],
    ['Columns Included', statisticianDatasetHeaders.join(', ')],
  ]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Export Summary');
  XLSX.utils.book_append_sheet(workbook, datasetSheet, 'Blinded Dataset');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
};

const generatePdfBuffer = async (input: {
  studyTitle: string;
  analysisTitle: string;
  analysisType?: string;
  principalInvestigatorName?: string;
  supervisorName?: string;
  assistantSupervisorName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  prompt?: string;
  result?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  ocr?: Record<string, unknown>;
  createdAt: string;
}) => {
  const document = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks: Buffer[] = [];

  document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  const endPromise = new Promise<Buffer>((resolve) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const executiveSummary =
    getPdfNarrative(input.result?.summaryText, '') ||
    getAssistantSummary(input.assistant) ||
    'This report summarises the saved analysis result, its statistical findings, and the generated interpretation.';

  drawReportHeader(document, {
    studyTitle: input.studyTitle,
    analysisTitle: input.analysisTitle,
    analysisType: input.analysisType,
    generatedAt: input.createdAt,
  });

  writeSectionHeading(document, 'Study Identity');
  writeBulletLines(
    document,
    buildReportIdentityLines({
      studyTitle: input.studyTitle,
      analysisTitle: input.analysisTitle,
      analysisType: input.analysisType,
      principalInvestigatorName: input.principalInvestigatorName,
      supervisorName: input.supervisorName,
      assistantSupervisorName: input.assistantSupervisorName,
      ethicsApprovalNumber: input.ethicsApprovalNumber,
      clinicalRegistrationNumber: input.clinicalRegistrationNumber,
      generatedAt: input.createdAt,
    }),
  );

  writeSectionHeading(document, 'Executive Summary');
  writeParagraph(document, executiveSummary);

  if (input.prompt) {
    writeSectionHeading(document, 'Research Question');
    writeParagraph(
      document,
      getPdfNarrative(input.prompt, 'The workspace did not include a written research prompt for this analysis.'),
    );
  }

  if (input.profile) {
    writeSectionHeading(document, 'Dataset Profile');
    writeBulletLines(document, buildProfileSummaryLines(input.profile));
  }

  if (input.result) {
    writeSectionHeading(document, 'Statistical Findings');
    writeBulletLines(document, buildFindingLines(input.result));
  }

  writeSectionHeading(document, 'Interpretation');
  writeParagraph(document, getAssistantSummary(input.assistant));

  if (input.ocr) {
    writeSectionHeading(document, 'OCR Notes');
    writeParagraph(document, getOcrSummary(input.ocr));
  }

  writeSectionHeading(document, 'Conclusion');
  writeParagraph(
    document,
    'This PDF is an academic-style, study-linked snapshot of the saved analysis. Use the workspace for interactive charts, raw outputs, and the full multilingual narrative when needed.',
  );

  document.moveDown();
  document.font('Helvetica-Oblique').fontSize(8.5).fillColor('#64748b').text(
    'Prepared by ClinResearch AI for structured academic review. Verify interpretation against the approved protocol and statistical analysis plan before submission.',
    { align: 'center' },
  );

  document.end();
  return endPromise;
};

const generateWordBuffer = async (input: {
  studyTitle: string;
  analysisTitle: string;
  analysisType?: string;
  principalInvestigatorName?: string;
  supervisorName?: string;
  assistantSupervisorName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  prompt?: string;
  result?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  ocr?: Record<string, unknown>;
  createdAt: string;
}) => {
  const executiveSummary =
    getPdfNarrative(input.result?.summaryText, '') ||
    getAssistantSummary(input.assistant) ||
    'This report summarises the saved analysis result, its statistical findings, and the generated interpretation.';

  const children: Paragraph[] = [
    new Paragraph({
      text: 'CLINRESEARCH AI',
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      text: 'Academic Statistical Report',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
    new Paragraph({
      text: `${sanitizePdfText(input.studyTitle) || 'Untitled study'} | ${sanitizePdfText(input.analysisTitle) || 'Untitled analysis'}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      text: `Generated ${sanitizePdfText(input.createdAt) || 'Not available'} | ${sanitizePdfText(input.analysisType) || 'Not specified'}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
    new Paragraph({
      text: 'Study Identity',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
    }),
    ...buildWordBulletParagraphs(
      buildReportIdentityLines({
        studyTitle: input.studyTitle,
        analysisTitle: input.analysisTitle,
        analysisType: input.analysisType,
        principalInvestigatorName: input.principalInvestigatorName,
        supervisorName: input.supervisorName,
        assistantSupervisorName: input.assistantSupervisorName,
        ethicsApprovalNumber: input.ethicsApprovalNumber,
        clinicalRegistrationNumber: input.clinicalRegistrationNumber,
        generatedAt: input.createdAt,
      }),
    ),
    new Paragraph({
      text: 'Executive Summary',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
    }),
    buildWordParagraph(executiveSummary),
  ];

  if (input.prompt) {
    children.push(
      new Paragraph({
        text: 'Research Question',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
      }),
      buildWordParagraph(
        getPdfNarrative(input.prompt, 'The workspace did not include a written research prompt for this analysis.'),
      ),
    );
  }

  if (input.profile) {
    children.push(
      new Paragraph({
        text: 'Dataset Profile',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
      }),
      ...buildWordBulletParagraphs(buildProfileSummaryLines(input.profile)),
    );
  }

  if (input.result) {
    children.push(
      new Paragraph({
        text: 'Statistical Findings',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
      }),
      ...buildWordBulletParagraphs(buildFindingLines(input.result)),
    );
  }

  children.push(
    new Paragraph({
      text: 'Interpretation',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
    }),
    buildWordParagraph(getAssistantSummary(input.assistant)),
  );

  if (input.ocr) {
    children.push(
      new Paragraph({
        text: 'OCR Notes',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
      }),
      buildWordParagraph(getOcrSummary(input.ocr)),
    );
  }

  children.push(
    new Paragraph({
      text: 'Conclusion',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
    }),
    buildWordParagraph(
      'This Word report is an academic-style, study-linked snapshot of the saved analysis. Use the workspace for interactive charts, raw outputs, and the full multilingual narrative when needed.',
    ),
    new Paragraph({
      text: 'Prepared by ClinResearch AI for structured academic review. Verify interpretation against the approved protocol and statistical analysis plan before submission.',
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 0 },
    }),
  );

  const document = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
};

export const getStudyResources = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  const [files, analyses] = await Promise.all([listStudyFiles(study.id), listStudyAnalyses(study.id)]);

  return res.json({
    study,
    files,
    analyses,
  });
};

export const uploadStudyFile = async (req: MulterRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }
  if (!ensureStudyNotLocked(study, res)) {
    return;
  }

  if (!req.user || !['student', 'co_researcher'].includes(req.user.accountType)) {
    return res.status(403).json({ message: 'Only researchers can upload study files' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'A file is required' });
  }

  const category = inferFileCategory(req.file, typeof req.body.fileCategory === 'string' ? req.body.fileCategory : undefined);
  const saved = await saveBufferToStudyBucket(study.id, 'files', req.file.originalname, req.file.buffer);
  const fileRecord = await createStudyFileRecord({
    studyId: study.id,
    uploadedByUserId: req.user!.id,
    originalName: req.file.originalname,
    storedName: saved.storedName,
    relativePath: saved.relativePath,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    fileCategory: category,
  });

  return res.status(201).json(fileRecord);
};

export const downloadStudyFile = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  const fileId = Array.isArray(req.params.fileId) ? req.params.fileId[0] : req.params.fileId;
  const fileRecord = await getStudyFileById(fileId);

  if (!fileRecord || fileRecord.studyId !== study.id) {
    return res.status(404).json({ message: 'File not found' });
  }

  return res.download(resolveStoredPath(fileRecord.relativePath), fileRecord.originalName);
};

export const runPersistedStudyAnalysis = async (req: MulterRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }
  if (!ensureStudyNotLocked(study, res)) {
    return;
  }

  if (!req.user || !['student', 'co_researcher'].includes(req.user.accountType)) {
    return res.status(403).json({ message: 'Only researchers can run study analyses' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'A file is required' });
  }

  const config = parseJsonField<Record<string, unknown>>(req.body.config, {});
  const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : `${study.title} analysis`;
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
  const mode = typeof req.body.mode === 'string' && req.body.mode.trim() ? req.body.mode.trim() : 'results_explanation';
  const category = inferFileCategory(req.file, typeof req.body.fileCategory === 'string' ? req.body.fileCategory : undefined);

  const saved = await saveBufferToStudyBucket(study.id, 'files', req.file.originalname, req.file.buffer);
  const fileRecord = await createStudyFileRecord({
    studyId: study.id,
    uploadedByUserId: req.user!.id,
    originalName: req.file.originalname,
    storedName: saved.storedName,
    relativePath: saved.relativePath,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    fileCategory: category,
  });

  const analysisPayload = (await postMultipartToAnalytics('/analysis/run', req.file, {
    config: JSON.stringify(config),
  })) as Record<string, unknown>;

  let ocrPayload: Record<string, unknown> | undefined;
  if (category === 'image') {
    try {
      ocrPayload = (await postMultipartToAnalytics('/ocr/extract', req.file, {})) as Record<string, unknown>;
    } catch {
      ocrPayload = undefined;
    }
  }

  let assistantPayload: Record<string, unknown> | undefined;
  if (prompt) {
    try {
      assistantPayload = (await postJsonToAnalytics('/assistant/chat', {
        mode,
        prompt,
        protocol_text: prompt,
        dataset_profile: analysisPayload.profile ?? null,
        statistical_result: analysisPayload,
        study_context: config,
      })) as Record<string, unknown>;
    } catch {
      assistantPayload = undefined;
    }
  }

  const analysisRecord = await createStudyAnalysisRecord({
    studyId: study.id,
    sourceFileId: fileRecord?.id,
    createdByUserId: req.user!.id,
    title,
    analysisType: typeof analysisPayload.analysis === 'string' ? analysisPayload.analysis : typeof config.analysis_type === 'string' ? config.analysis_type : undefined,
    assistantMode: mode,
    prompt: prompt || undefined,
    config,
    profile: (analysisPayload.profile as Record<string, unknown> | undefined) ?? undefined,
    result: analysisPayload,
    assistant: assistantPayload,
    ocr: ocrPayload,
  });

  if (!analysisRecord) {
    return res.status(500).json({ message: 'Unable to save the analysis record' });
  }

  const reportBuffer = await generatePdfBuffer({
    studyTitle: study.title,
    analysisTitle: analysisRecord.title,
    analysisType: analysisRecord.analysisType,
    principalInvestigatorName: study.principalInvestigatorName,
    supervisorName: study.supervisorName,
    assistantSupervisorName: study.assistantSupervisorName,
    ethicsApprovalNumber: study.ethicsApprovalNumber,
    clinicalRegistrationNumber: study.clinicalRegistrationNumber,
    prompt: analysisRecord.prompt,
    result: analysisRecord.result,
    assistant: analysisRecord.assistant,
    profile: analysisRecord.profile,
    ocr: analysisRecord.ocr,
    createdAt: analysisRecord.createdAt,
  });

  const storedReport = await saveBufferToStudyBucket(study.id, 'reports', `${analysisRecord.title}.pdf`, reportBuffer);
  await updateStudyAnalysisReportPath(analysisRecord.id, storedReport.relativePath);

  return res.status(201).json({
    file: fileRecord,
    analysis: {
      ...analysisRecord,
      reportRelativePath: storedReport.relativePath,
    },
  });
};

export const getStudyAnalysesList = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  return res.json(await listStudyAnalyses(study.id));
};

export const downloadAnalysisReportPdf = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  const analysisId = Array.isArray(req.params.analysisId) ? req.params.analysisId[0] : req.params.analysisId;
  const analysis = await getStudyAnalysisById(analysisId);

  if (!analysis || analysis.studyId !== study.id) {
    return res.status(404).json({ message: 'Analysis not found' });
  }

  if (analysis.reportRelativePath) {
    try {
      await fs.access(resolveStoredPath(analysis.reportRelativePath));
      return res.download(resolveStoredPath(analysis.reportRelativePath), `${analysis.title}.pdf`);
    } catch {
      // Fall through and regenerate the report if the file is missing.
    }
  }

  const buffer = await generatePdfBuffer({
    studyTitle: study.title,
    analysisTitle: analysis.title,
    analysisType: analysis.analysisType,
    principalInvestigatorName: study.principalInvestigatorName,
    supervisorName: study.supervisorName,
    assistantSupervisorName: study.assistantSupervisorName,
    ethicsApprovalNumber: study.ethicsApprovalNumber,
    clinicalRegistrationNumber: study.clinicalRegistrationNumber,
    prompt: analysis.prompt,
    result: analysis.result,
    assistant: analysis.assistant,
    profile: analysis.profile,
    ocr: analysis.ocr,
    createdAt: analysis.createdAt,
  });

  const stored = await saveBufferToStudyBucket(study.id, 'reports', `${analysis.title}.pdf`, buffer);
  await updateStudyAnalysisReportPath(analysis.id, stored.relativePath);

  return res.download(stored.absolutePath, `${analysis.title}.pdf`);
};

export const downloadAnalysisReportWord = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  const analysisId = Array.isArray(req.params.analysisId) ? req.params.analysisId[0] : req.params.analysisId;
  const analysis = await getStudyAnalysisById(analysisId);

  if (!analysis || analysis.studyId !== study.id) {
    return res.status(404).json({ message: 'Analysis not found' });
  }

  const buffer = await generateWordBuffer({
    studyTitle: study.title,
    analysisTitle: analysis.title,
    analysisType: analysis.analysisType,
    principalInvestigatorName: study.principalInvestigatorName,
    supervisorName: study.supervisorName,
    assistantSupervisorName: study.assistantSupervisorName,
    ethicsApprovalNumber: study.ethicsApprovalNumber,
    clinicalRegistrationNumber: study.clinicalRegistrationNumber,
    prompt: analysis.prompt,
    result: analysis.result,
    assistant: analysis.assistant,
    profile: analysis.profile,
    ocr: analysis.ocr,
    createdAt: analysis.createdAt,
  });

  const fileName = `${sanitizeFileBaseName(analysis.title)}.docx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
};

export const downloadStatisticianDatasetExport = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  if (!req.user || !['student', 'co_researcher', 'supervisor', 'assistant_supervisor'].includes(req.user.accountType)) {
    return res.status(403).json({ message: 'Only the research and supervision team can export the statistician dataset' });
  }

  const samples = await listOutcomeAssessmentSamplesForStudy(study.id);
  const rows = buildStatisticianDatasetRows(study, samples);
  const csvContent = generateStatisticianCsvContent(rows);

  const fileName = `${sanitizeFileBaseName(study.title)}-statistician-dataset.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(`\uFEFF${csvContent}`);
};

export const downloadStatisticianDatasetExportXlsx = async (req: AuthRequest, res: Response) => {
  const study = await ensureAccessibleStudy(req, res);
  if (!study) {
    return;
  }

  if (!req.user || !['student', 'co_researcher', 'supervisor', 'assistant_supervisor'].includes(req.user.accountType)) {
    return res.status(403).json({ message: 'Only the research and supervision team can export the statistician dataset' });
  }

  const samples = await listOutcomeAssessmentSamplesForStudy(study.id);
  const rows = buildStatisticianDatasetRows(study, samples);
  const buffer = generateStatisticianWorkbookBuffer({
    studyTitle: study.title,
    generatedAt: new Date().toISOString(),
    masked: Boolean(study.blindingSettings?.permissions.maskGroupsForStatistician),
    rows,
  });

  const fileName = `${sanitizeFileBaseName(study.title)}-statistician-dataset.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
};
