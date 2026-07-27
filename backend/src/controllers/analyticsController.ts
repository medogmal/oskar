import type { Request, Response } from 'express';

const analyticsBaseUrl = (process.env.PYTHON_ANALYTICS_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
const analyticsTimeoutMs = Number(process.env.PYTHON_ANALYTICS_TIMEOUT_MS ?? 120000);
const knowledgeBaseUrl = (process.env.KNOWLEDGE_ENGINE_URL ?? analyticsBaseUrl).replace(/\/$/, '');


type MulterRequest = Request & {
  file?: Express.Multer.File;
};

type KnowledgeCitation = {
  source_file?: string;
  page?: number;
  section?: string;
  quoted_text?: string;
};

type KnowledgeQueryResponse = {
  answer: string;
  citations: KnowledgeCitation[];
  error?: string;
  retrieval?: {
    strategy: 'filtered_only' | 'filtered_then_broadened' | 'broadened_only';
    fallbackApplied: boolean;
    effectiveFilterSource?: string;
    notice?: string;
    attempts: Array<{
      label: string;
      filterSource?: string;
      citationCount: number;
      useful: boolean;
    }>;
  };
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const clampKnowledgeLimit = (value: unknown) => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 6;
  }

  return Math.min(12, Math.max(3, Math.trunc(parsed)));
};

const asKnowledgeQueryResponse = (value: unknown): KnowledgeQueryResponse => {
  const payload = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    answer: typeof payload.answer === 'string' ? payload.answer : '',
    citations: Array.isArray(payload.citations) ? (payload.citations as KnowledgeCitation[]) : [],
    error: typeof payload.error === 'string' ? payload.error : undefined,
  };
};

const isKnowledgePayloadUseful = (payload: KnowledgeQueryResponse) => payload.citations.length > 0;

const getKeywordCandidates = (value: string, maxKeywords = 8) =>
  Array.from(
    new Set(
      value
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4),
    ),
  ).slice(0, maxKeywords);

const getRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const normalizeStudyType = (value: unknown) => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return undefined;
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
    : undefined;
};

const detectResponseLanguage = (value: unknown) => {
  const text = typeof value === 'string' ? value : '';
  if (!text.trim()) {
    return 'english';
  }

  const arabicCount = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const mojibakeArabicCount = (text.match(/[ØÙ][\x80-\xBF]?/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (arabicCount > 0 && arabicCount >= Math.max(3, latinCount * 0.25)) {
    return 'arabic';
  }
  if (mojibakeArabicCount >= 3) {
    return 'arabic';
  }
  return 'english';
};

const normalizeResponseLanguage = (value: unknown, fallbackText: string) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['arabic', 'ar', 'rtl'].includes(normalized)) {
    return 'arabic';
  }
  if (['english', 'en', 'ltr'].includes(normalized)) {
    return 'english';
  }
  return detectResponseLanguage(fallbackText);
};

const getStudyTypeFromRequestContext = (studyContext: unknown, explicitStudyType?: unknown) => {
  const explicit = normalizeStudyType(explicitStudyType);
  if (explicit) {
    return explicit;
  }
  const context = getRecord(studyContext);
  const metadata = getRecord(context?.study_metadata);
  return normalizeStudyType(metadata?.studyType ?? metadata?.study_type);
};

const getTextList = (value: unknown, maxItems = 5) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? normalizeWhitespace(item) : ''))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

const buildKnowledgeQueryCandidates = (input: {
  question: string;
  mode?: unknown;
  filterSource?: string;
  requestedLimit: number;
  studyType?: string;
  protocolText?: unknown;
  studyContext?: unknown;
}) => {
  const normalizedQuestion = normalizeWhitespace(input.question);
  const studyContext = getRecord(input.studyContext);
  const studyMetadata = getRecord(studyContext?.study_metadata);
  const retrievedResources = getRecord(studyContext?.retrieved_resources);
  const retrievedFiles = getTextList(retrievedResources?.files ? (retrievedResources.files as Array<Record<string, unknown>>).map((item) => item.originalName) : []);
  const retrievedAnalyses = getTextList(
    retrievedResources?.analyses ? (retrievedResources.analyses as Array<Record<string, unknown>>).map((item) => item.title) : [],
  );
  const protocolSnippet =
    typeof input.protocolText === 'string' && input.protocolText.trim()
      ? normalizeWhitespace(input.protocolText).slice(0, 320)
      : '';
  const studyHints = [
    typeof studyMetadata?.title === 'string' ? normalizeWhitespace(studyMetadata.title) : '',
    typeof studyMetadata?.studyType === 'string' ? normalizeWhitespace(studyMetadata.studyType) : '',
    typeof studyMetadata?.status === 'string' ? normalizeWhitespace(studyMetadata.status) : '',
  ].filter(Boolean);
  const keywordCandidates = getKeywordCandidates(
    [normalizedQuestion, protocolSnippet, ...studyHints, ...retrievedFiles, ...retrievedAnalyses].join(' '),
  );

  const contextualQuestion = [
    normalizedQuestion,
    studyHints.length ? `Study context: ${studyHints.join(' | ')}` : '',
    protocolSnippet ? `Protocol excerpt: ${protocolSnippet}` : '',
    retrievedFiles.length ? `Available study files: ${retrievedFiles.join(', ')}` : '',
    retrievedAnalyses.length ? `Saved analyses: ${retrievedAnalyses.join(', ')}` : '',
    input.mode ? `Assistant mode: ${String(input.mode)}` : '',
    'Answer only from indexed references and prefer the most directly relevant evidence.',
  ]
    .filter(Boolean)
    .join('\n');

  const keywordFocusedQuestion = keywordCandidates.length
    ? [
        normalizedQuestion,
        `Focus keywords: ${keywordCandidates.join(', ')}`,
        'Return the closest evidence-backed answer and include citations whenever possible.',
      ].join('\n')
    : '';

  return Array.from(new Set([normalizedQuestion, contextualQuestion, keywordFocusedQuestion].filter(Boolean))).map((question) => ({
    question,
    filter_source: input.filterSource || undefined,
    study_type: input.studyType,
    limit: input.requestedLimit,
  }));
};

const buildQueryAttemptLabel = (filterSource?: string, isFallback = false) => {
  if (filterSource && !isFallback) {
    return 'filtered';
  }

  if (!filterSource && isFallback) {
    return 'broadened';
  }

  return 'default';
};

const queryKnowledgeEngineWithFallback = async (input: {
  question: string;
  mode?: unknown;
  filterSource?: string;
  studyType?: unknown;
  requestedLimit?: unknown;
  protocolText?: unknown;
  studyContext?: unknown;
}) => {
  const studyType = getStudyTypeFromRequestContext(input.studyContext, input.studyType);
  const candidates = buildKnowledgeQueryCandidates({
    question: input.question,
    mode: input.mode,
    filterSource: input.filterSource,
    requestedLimit: clampKnowledgeLimit(input.requestedLimit),
    studyType,
    protocolText: input.protocolText,
    studyContext: input.studyContext,
  });
  const broadenedCandidates = input.filterSource
    ? buildKnowledgeQueryCandidates({
        question: input.question,
        mode: input.mode,
        filterSource: undefined,
        requestedLimit: Math.min(12, clampKnowledgeLimit(input.requestedLimit) + 2),
        studyType,
        protocolText: input.protocolText,
        studyContext: input.studyContext,
      })
    : [];

  let lastPayload: KnowledgeQueryResponse = { answer: '', citations: [] };
  let lastError: Error | null = null;
  const attempts: NonNullable<KnowledgeQueryResponse['retrieval']>['attempts'] = [];

  for (const [index, candidate] of candidates.entries()) {
    try {
      const payload = asKnowledgeQueryResponse(
        await forwardJsonRequest(knowledgeBaseUrl, '/api/v1/query', candidate),
      );
      lastPayload = payload;
      attempts.push({
        label: `${buildQueryAttemptLabel(candidate.filter_source)}_${index + 1}`,
        filterSource: candidate.filter_source,
        citationCount: payload.citations.length,
        useful: isKnowledgePayloadUseful(payload),
      });

      if (isKnowledgePayloadUseful(payload)) {
        return {
          ...payload,
          retrieval: {
            strategy: input.filterSource ? 'filtered_only' : 'broadened_only',
            fallbackApplied: false,
            effectiveFilterSource: candidate.filter_source,
            attempts,
          },
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unable to query knowledge engine');
    }
  }

  for (const [index, candidate] of broadenedCandidates.entries()) {
    try {
      const payload = asKnowledgeQueryResponse(
        await forwardJsonRequest(knowledgeBaseUrl, '/api/v1/query', candidate),
      );
      lastPayload = payload;
      attempts.push({
        label: `${buildQueryAttemptLabel(candidate.filter_source, true)}_${index + 1}`,
        filterSource: candidate.filter_source,
        citationCount: payload.citations.length,
        useful: isKnowledgePayloadUseful(payload),
      });

      if (isKnowledgePayloadUseful(payload)) {
        return {
          ...payload,
          retrieval: {
            strategy: 'filtered_then_broadened',
            fallbackApplied: true,
            effectiveFilterSource: candidate.filter_source,
            notice:
              'No grounded answer was found inside the selected source only, so the search was broadened across indexed references.',
            attempts,
          },
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unable to query knowledge engine');
    }
  }

  if (lastPayload.answer || lastPayload.citations.length > 0) {
    return {
      ...lastPayload,
      retrieval: {
        strategy: input.filterSource ? 'filtered_then_broadened' : 'broadened_only',
        fallbackApplied: Boolean(input.filterSource),
        effectiveFilterSource: input.filterSource,
        notice: input.filterSource
          ? 'The search tried the selected file first, then broadened the scope, but no grounded evidence was returned.'
          : 'The knowledge engine responded, but it did not return grounded evidence for this question.',
        attempts,
      },
    };
  }

  if (lastError) {
    throw lastError;
  }

  return {
    ...lastPayload,
    retrieval: {
      strategy: input.filterSource ? 'filtered_then_broadened' : 'broadened_only',
      fallbackApplied: Boolean(input.filterSource),
      effectiveFilterSource: input.filterSource,
      notice: input.filterSource
        ? 'The selected source and the broadened search both failed to produce grounded evidence.'
        : 'The knowledge engine did not return grounded evidence for this question.',
      attempts,
    },
  };
};

const getErrorPayload = async (response: globalThis.Response) => {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return { detail: await response.text() };
};

const forwardJsonRequest = async (baseUrl: string, path: string, body: unknown, init?: RequestInit) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(analyticsTimeoutMs),
    ...init,
  });

  if (!response.ok) {
    const payload = await getErrorPayload(response);
    throw new Error(payload.detail || payload.message || 'Remote JSON request failed');
  }

  return response.json();
};

const forwardMultipartRequest = async (
  file: Express.Multer.File | undefined,
  path: string,
  fields: Record<string, string> = {},
) => {
  if (!file) {
    throw new Error('A file is required');
  }

  const formData = new FormData();
  const mimeType = file.mimetype || 'application/octet-stream';
  const blob = new Blob([new Uint8Array(file.buffer)], { type: mimeType });
  formData.append('file', blob, file.originalname);

  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  const response = await fetch(`${analyticsBaseUrl}${path}`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(analyticsTimeoutMs),
  });

  if (!response.ok) {
    const payload = await getErrorPayload(response);
    throw new Error(payload.detail || payload.message || 'Python analytics request failed');
  }

  return response.json();
};

export const getAnalyticsHealth = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${analyticsBaseUrl}/health`, {
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });

    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }

    return res.json(await response.json());
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : 'Analytics service is unavailable',
    });
  }
};

export const profileDataset = async (req: MulterRequest, res: Response) => {
  try {
    const payload = await forwardMultipartRequest(req.file, '/dataset/profile', {
      options: typeof req.body.options === 'string' ? req.body.options : JSON.stringify(req.body.options ?? {}),
    });
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to profile the dataset',
    });
  }
};

export const recommendAnalysis = async (req: Request, res: Response) => {
  try {
    const formData = new FormData();
    formData.append('config', JSON.stringify(req.body ?? {}));

    const response = await fetch(`${analyticsBaseUrl}/analysis/recommend`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });

    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }

    return res.json(await response.json());
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to recommend an analysis',
    });
  }
};

export const runAnalysis = async (req: MulterRequest, res: Response) => {
  try {
    const payload = await forwardMultipartRequest(req.file, '/analysis/run', {
      config: typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config ?? {}),
    });
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to run the analysis',
    });
  }
};

export const runOcrExtraction = async (req: MulterRequest, res: Response) => {
  try {
    const payload = await forwardMultipartRequest(req.file, '/ocr/extract');
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to extract OCR text',
    });
  }
};

export const extractDocumentText = async (req: MulterRequest, res: Response) => {
  try {
    const payload = await forwardMultipartRequest(req.file, '/document/extract-text');
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to extract document text',
    });
  }
};

export const runAssistantChat = async (req: Request, res: Response) => {
  try {
    const prompt =
      typeof req.body?.prompt === 'string'
        ? req.body.prompt.trim()
        : typeof req.body?.question === 'string'
          ? req.body.question.trim()
          : '';
    const shouldUseKnowledge =
      Boolean(req.body?.useKnowledgeEngine) &&
      prompt.length > 0;
    let knowledgePayload: unknown;

    if (shouldUseKnowledge) {
      try {
        knowledgePayload = await queryKnowledgeEngineWithFallback({
          question: prompt,
          mode: req.body?.mode,
          studyType: req.body?.study_type,
          filterSource:
            typeof req.body?.knowledgeFilterSource === 'string' && req.body.knowledgeFilterSource.trim().length > 0
              ? req.body.knowledgeFilterSource.trim()
              : undefined,
          requestedLimit: req.body?.knowledgeLimit,
          protocolText: req.body?.protocol_text,
          studyContext: req.body?.study_context,
        });
      } catch (error) {
        knowledgePayload = {
          answer: '',
          citations: [],
          error: error instanceof Error ? error.message : 'Unable to query knowledge engine',
        };
      }
    }

    const response = await fetch(`${analyticsBaseUrl}/assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(req.body ?? {}),
        response_language: normalizeResponseLanguage(req.body?.response_language, prompt),
        study_context: {
          ...(req.body?.study_context ?? {}),
          knowledge_context: knowledgePayload ?? undefined,
        },
      }),
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });

    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }

    const assistantPayload = (await response.json()) as Record<string, unknown>;
    return res.json({
      ...assistantPayload,
      knowledge: knowledgePayload ?? null,
    });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to process the assistant request',
    });
  }
};

export const getKnowledgeHealth = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${knowledgeBaseUrl}/health`, {
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });

    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }

    return res.json(await response.json());
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : 'Knowledge engine is unavailable',
    });
  }
};

export const ingestKnowledgeDocument = async (req: MulterRequest, res: Response) => {
  try {
    const payload = await forwardMultipartRequest(req.file, '/api/v1/ingest', {
      document_type:
        typeof req.body.document_type === 'string' && req.body.document_type.trim().length > 0
          ? req.body.document_type
          : 'reference',
    });
    return res.status(201).json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to ingest document into the knowledge engine',
    });
  }
};

export const queryKnowledgeBase = async (req: Request, res: Response) => {
  try {
    const payload = await queryKnowledgeEngineWithFallback({
      question:
        typeof req.body?.question === 'string'
          ? req.body.question
          : typeof req.body?.prompt === 'string'
            ? req.body.prompt
            : '',
      mode: req.body?.mode,
      studyType: req.body?.study_type,
      filterSource:
        typeof req.body?.filter_source === 'string' && req.body.filter_source.trim().length > 0
          ? req.body.filter_source.trim()
          : undefined,
      requestedLimit: req.body?.limit,
      protocolText: req.body?.protocol_text,
      studyContext: req.body?.study_context,
    });
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to query the knowledge engine',
    });
  }
};

export const calculateKnowledgeSampleSize = async (req: Request, res: Response) => {
  try {
    const payload = await forwardJsonRequest(knowledgeBaseUrl, '/api/v1/calculate', req.body ?? {});
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to calculate sample size',
    });
  }
};

export const validateKnowledgeClinicalParameters = async (req: Request, res: Response) => {
  try {
    const payload = await forwardJsonRequest(knowledgeBaseUrl, '/api/v1/validate', req.body ?? {});
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to validate clinical parameters',
    });
  }
};

export const getKnowledgeStudyTypes = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${analyticsBaseUrl}/knowledge/study-types`, {
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });
    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }
    return res.json(await response.json());
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : 'Knowledge study types unavailable',
    });
  }
};

export const getKnowledgeReferences = async (req: Request, res: Response) => {
  try {
    const rawStudyType = req.params.studyType || req.query.studyType;
    const studyType = Array.isArray(rawStudyType)
      ? String(rawStudyType[0])
      : typeof rawStudyType === 'string'
        ? rawStudyType
        : 'rct';
    const response = await fetch(`${analyticsBaseUrl}/knowledge/references?study_type=${encodeURIComponent(studyType)}`, {
      signal: AbortSignal.timeout(analyticsTimeoutMs),
    });

    if (!response.ok) {
      const payload = await getErrorPayload(response);
      return res.status(response.status).json(payload);
    }
    return res.json(await response.json());
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : 'Knowledge references unavailable',
    });
  }
};

