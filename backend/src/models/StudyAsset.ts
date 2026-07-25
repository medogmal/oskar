import { query } from '../db.js';

export type StudyFileCategory = 'protocol' | 'dataset' | 'image' | 'attachment' | 'report';

export type StudyFileRecord = {
  id: string;
  studyId: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType?: string;
  sizeBytes: number;
  fileCategory: StudyFileCategory;
  uploadedByName?: string;
  createdAt: string;
};

export type StudyAnalysisRecord = {
  id: string;
  studyId: string;
  sourceFileId?: string;
  createdByName?: string;
  title: string;
  analysisType?: string;
  assistantMode?: string;
  prompt?: string;
  config: Record<string, unknown>;
  profile?: Record<string, unknown>;
  result?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  ocr?: Record<string, unknown>;
  reportRelativePath?: string;
  createdAt: string;
  updatedAt: string;
};

type StudyFileRow = {
  id: string | number;
  study_id: string | number;
  original_name: string;
  stored_name: string;
  relative_path: string;
  mime_type: string | null;
  size_bytes: number;
  file_category: StudyFileCategory;
  uploaded_by_name: string | null;
  created_at: Date | string;
};

type StudyAnalysisRow = {
  id: string | number;
  study_id: string | number;
  source_file_id: string | number | null;
  created_by_name: string | null;
  title: string;
  analysis_type: string | null;
  assistant_mode: string | null;
  prompt: string | null;
  config_json: Record<string, unknown>;
  profile_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  assistant_json: Record<string, unknown> | null;
  ocr_json: Record<string, unknown> | null;
  report_relative_path: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const mapStudyFile = (row: StudyFileRow): StudyFileRecord => ({
  id: String(row.id),
  studyId: String(row.study_id),
  originalName: row.original_name,
  storedName: row.stored_name,
  relativePath: row.relative_path,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: Number(row.size_bytes),
  fileCategory: row.file_category,
  uploadedByName: row.uploaded_by_name ?? undefined,
  createdAt: new Date(row.created_at).toISOString(),
});

const mapStudyAnalysis = (row: StudyAnalysisRow): StudyAnalysisRecord => ({
  id: String(row.id),
  studyId: String(row.study_id),
  sourceFileId: row.source_file_id ? String(row.source_file_id) : undefined,
  createdByName: row.created_by_name ?? undefined,
  title: row.title,
  analysisType: row.analysis_type ?? undefined,
  assistantMode: row.assistant_mode ?? undefined,
  prompt: row.prompt ?? undefined,
  config: row.config_json ?? {},
  profile: row.profile_json ?? undefined,
  result: row.result_json ?? undefined,
  assistant: row.assistant_json ?? undefined,
  ocr: row.ocr_json ?? undefined,
  reportRelativePath: row.report_relative_path ?? undefined,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const createStudyFileRecord = async (input: {
  studyId: string;
  uploadedByUserId: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType?: string;
  sizeBytes: number;
  fileCategory: StudyFileCategory;
}) => {
  const result = await query<StudyFileRow>(
    `
      INSERT INTO study_files (
        study_id, uploaded_by_user_id, original_name, stored_name, relative_path, mime_type, size_bytes, file_category
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        study_files.*,
        NULL::TEXT AS uploaded_by_name
    `,
    [
      input.studyId,
      input.uploadedByUserId,
      input.originalName,
      input.storedName,
      input.relativePath,
      input.mimeType ?? null,
      input.sizeBytes,
      input.fileCategory,
    ],
  );

  return getStudyFileById(String(result.rows[0].id));
};

export const getStudyFileById = async (fileId: string): Promise<StudyFileRecord | null> => {
  const result = await query<StudyFileRow>(
    `
      SELECT
        study_files.*,
        users.full_name AS uploaded_by_name
      FROM study_files
      JOIN users ON users.id = study_files.uploaded_by_user_id
      WHERE study_files.id = $1
      LIMIT 1
    `,
    [fileId],
  );

  const row = result.rows[0];
  return row ? mapStudyFile(row) : null;
};

export const listStudyFiles = async (studyId: string): Promise<StudyFileRecord[]> => {
  const result = await query<StudyFileRow>(
    `
      SELECT
        study_files.*,
        users.full_name AS uploaded_by_name
      FROM study_files
      JOIN users ON users.id = study_files.uploaded_by_user_id
      WHERE study_files.study_id = $1
      ORDER BY study_files.created_at DESC
    `,
    [studyId],
  );

  return result.rows.map(mapStudyFile);
};

export const createStudyAnalysisRecord = async (input: {
  studyId: string;
  sourceFileId?: string;
  createdByUserId: string;
  title: string;
  analysisType?: string;
  assistantMode?: string;
  prompt?: string;
  config: Record<string, unknown>;
  profile?: Record<string, unknown>;
  result?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  ocr?: Record<string, unknown>;
  reportRelativePath?: string;
}) => {
  const result = await query<StudyAnalysisRow>(
    `
      INSERT INTO study_analyses (
        study_id, source_file_id, created_by_user_id, title, analysis_type, assistant_mode, prompt,
        config_json, profile_json, result_json, assistant_json, ocr_json, report_relative_path, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, NOW())
      RETURNING
        study_analyses.*,
        NULL::TEXT AS created_by_name
    `,
    [
      input.studyId,
      input.sourceFileId ?? null,
      input.createdByUserId,
      input.title,
      input.analysisType ?? null,
      input.assistantMode ?? null,
      input.prompt ?? null,
      JSON.stringify(input.config ?? {}),
      input.profile ? JSON.stringify(input.profile) : null,
      input.result ? JSON.stringify(input.result) : null,
      input.assistant ? JSON.stringify(input.assistant) : null,
      input.ocr ? JSON.stringify(input.ocr) : null,
      input.reportRelativePath ?? null,
    ],
  );

  return getStudyAnalysisById(String(result.rows[0].id));
};

export const updateStudyAnalysisReportPath = async (analysisId: string, reportRelativePath: string) => {
  await query(
    `
      UPDATE study_analyses
      SET report_relative_path = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [analysisId, reportRelativePath],
  );
};

export const getStudyAnalysisById = async (analysisId: string): Promise<StudyAnalysisRecord | null> => {
  const result = await query<StudyAnalysisRow>(
    `
      SELECT
        study_analyses.*,
        users.full_name AS created_by_name
      FROM study_analyses
      JOIN users ON users.id = study_analyses.created_by_user_id
      WHERE study_analyses.id = $1
      LIMIT 1
    `,
    [analysisId],
  );

  const row = result.rows[0];
  return row ? mapStudyAnalysis(row) : null;
};

export const listStudyAnalyses = async (studyId: string): Promise<StudyAnalysisRecord[]> => {
  const result = await query<StudyAnalysisRow>(
    `
      SELECT
        study_analyses.*,
        users.full_name AS created_by_name
      FROM study_analyses
      JOIN users ON users.id = study_analyses.created_by_user_id
      WHERE study_analyses.study_id = $1
      ORDER BY study_analyses.created_at DESC
    `,
    [studyId],
  );

  return result.rows.map(mapStudyAnalysis);
};
