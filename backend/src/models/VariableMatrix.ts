import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { query } from '../db.js';

export type VariableMatrixRecord = {
  id: string;
  studyId: string;
  fieldId?: string;
  label: string;
  definition: string;
  role: string;
  scale: string;
  source: string;
  measurementMethod: string;
  unit: string;
  linkedOutcomeIds: string[];
  linkedObjectiveIds?: string[];
  linkedResearchQuestionIds: string[];
  linkedReferenceIds: string[];
  recommendedStatisticalTest: string;
  responseType?: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
  required?: boolean;
  section?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

type VariableMatrixRow = {
  matrix_json: VariableMatrixRecord[] | string;
};

const localAuthFallbackEnabled = () => process.env.ENABLE_LOCAL_AUTH_FALLBACK !== 'false';
const isDatabaseUnavailable = (error: unknown) => localAuthFallbackEnabled() && error instanceof Error;
const localVariableMatrixStorePath = path.resolve(process.cwd(), 'data', 'dev-variable-matrices.json');

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

const normalizeMatrix = (studyId: string, records: VariableMatrixRecord[]) =>
  records.map((record) => ({
    ...record,
    studyId,
    linkedOutcomeIds: Array.isArray(record.linkedOutcomeIds) ? record.linkedOutcomeIds.map(String) : [],
    linkedObjectiveIds: Array.isArray(record.linkedObjectiveIds) ? record.linkedObjectiveIds.map(String) : [],
    linkedResearchQuestionIds: Array.isArray(record.linkedResearchQuestionIds) ? record.linkedResearchQuestionIds.map(String) : [],
    linkedReferenceIds: Array.isArray(record.linkedReferenceIds) ? record.linkedReferenceIds.map(String) : [],
    options: Array.isArray(record.options) ? record.options.map(String) : [],
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  }));

const readLocalMatrices = async (): Promise<Record<string, VariableMatrixRecord[]>> => {
  try {
    return JSON.parse(await readFile(localVariableMatrixStorePath, 'utf8')) as Record<string, VariableMatrixRecord[]>;
  } catch {
    return {};
  }
};

const writeLocalMatrices = async (payload: Record<string, VariableMatrixRecord[]>) => {
  await mkdir(path.dirname(localVariableMatrixStorePath), { recursive: true });
  await writeFile(localVariableMatrixStorePath, JSON.stringify(payload, null, 2), 'utf8');
};

export const getVariableMatrixByStudy = async (studyId: string) => {
  try {
    const result = await query<VariableMatrixRow>(
      `SELECT matrix_json
       FROM study_variable_mappings
       WHERE study_id = $1
       LIMIT 1`,
      [studyId],
    );

    return normalizeMatrix(studyId, parseJsonValue(result.rows[0]?.matrix_json, []));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const payload = await readLocalMatrices();
    return normalizeMatrix(studyId, payload[studyId] ?? []);
  }
};

export const saveVariableMatrixByStudy = async (studyId: string, actorUserId: string, matrix: VariableMatrixRecord[]) => {
  const normalized = normalizeMatrix(studyId, matrix);

  try {
    const result = await query<VariableMatrixRow>(
      `INSERT INTO study_variable_mappings (study_id, matrix_json, updated_by_user_id, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (study_id)
       DO UPDATE SET
         matrix_json = EXCLUDED.matrix_json,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()
       RETURNING matrix_json`,
      [studyId, JSON.stringify(normalized), actorUserId],
    );

    return normalizeMatrix(studyId, parseJsonValue(result.rows[0]?.matrix_json, normalized));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const payload = await readLocalMatrices();
    payload[studyId] = normalized;
    await writeLocalMatrices(payload);
    return normalized;
  }
};
