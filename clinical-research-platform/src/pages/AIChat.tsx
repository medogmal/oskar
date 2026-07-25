import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Bot, Brain, FileSearch, LoaderCircle, LogOut, ScanText, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { saveAutofillSnapshot } from '../lib/aiAutofill';
import { apiBaseUrl } from '../lib/auth';

type AnalyticsHealth = {
  status: string;
  libraries: Record<string, string>;
  openaiConfigured: boolean;
  openaiModel: string;
};

type KnowledgeHealth = {
  message?: string;
  version?: string;
  [key: string]: unknown;
};

type StudyOption = {
  id: string;
  title: string;
  studyType: string;
  status: string;
  isLocked?: boolean;
};

type PersistedStudyFile = {
  id: string;
  originalName: string;
  fileCategory: string;
  createdAt: string;
};

type PersistedStudyAnalysis = {
  id: string;
  title: string;
  analysisType?: string;
  reportRelativePath?: string;
  createdAt: string;
};

type StudyResourcesResponse = {
  files: PersistedStudyFile[];
  analyses: PersistedStudyAnalysis[];
};

type DatasetProfile = {
  rows: number;
  columns: number;
  columnNames: string[];
  numericColumns: string[];
  categoricalColumns: string[];
  missingValues: Record<string, number>;
  preview: Array<Record<string, unknown>>;
  suggestions: string[];
  columnDetails: Array<{
    name: string;
    dtype: string;
    missing: number;
    unique: number;
  }>;
};

type DatasetProfileResponse = {
  profile: DatasetProfile;
  cleaningApplied: Record<string, unknown>;
};

type PlotFigure = {
  data: unknown[];
  layout: Record<string, unknown>;
};

type AnalysisResult = {
  analysis?: string;
  pValue?: number;
  statistic?: number;
  auc?: number;
  formula?: string;
  summaryText?: string;
  recommended?: {
    recommended_test: string;
    reason: string;
  };
  profile?: DatasetProfile;
  figure?: PlotFigure | null;
  [key: string]: unknown;
};

type AssistantResult = {
  answer: string;
  usedLLM: boolean;
  model: string;
  extractedStudyElements?: {
    title?: string;
    objective?: string;
    keyElements?: string[];
    studyTypeGuess?: string;
  } | null;
};

type KnowledgeCitation = {
  source_file: string;
  page: number;
  section: string;
  quoted_text: string;
};

type KnowledgeRetrievalAttempt = {
  label: string;
  filterSource?: string;
  citationCount: number;
  useful: boolean;
};

type KnowledgeRetrievalMeta = {
  strategy: 'filtered_only' | 'filtered_then_broadened' | 'broadened_only';
  fallbackApplied: boolean;
  effectiveFilterSource?: string;
  notice?: string;
  attempts: KnowledgeRetrievalAttempt[];
};

type KnowledgeQueryResult = {
  answer: string;
  citations: KnowledgeCitation[];
  error?: string;
  retrieval?: KnowledgeRetrievalMeta;
};

type KnowledgeIngestResult = {
  message: string;
  filename: string;
  document_type: string;
  chunks_processed: number;
  evidence_rank: number;
  evidence_level_label: string;
  is_primary_reference: boolean;
  study_groups?: string[] | null;
  extracted_effect_size?: number | null;
  database_status: string;
};

type SampleSizeScenario = {
  label: string;
  effect_size: number;
  n_per_group: number;
  adjusted_n_per_group: number;
  total_sample_size: number;
};

type KnowledgeSampleSizeResult = {
  approved: boolean;
  message: string;
  proposed_effect_size?: number | null;
  scenarios?: SampleSizeScenario[] | null;
  test_used?: string | null;
  parameters?: Record<string, number> | null;
  required_sample_size_per_group?: number | null;
  adjusted_sample_size_per_group?: number | null;
  total_sample_size?: number | null;
  interpretation?: string | null;
};

type ClinicalDraft = {
  patientAge: string;
  pocketDepthMm: string;
  systolicBpMmhg: string;
  diastolicBpMmhg: string;
  heartRateBpm: string;
  smokingStatus: 'yes' | 'no';
};

type ClinicalValidationResult = {
  valid: boolean;
  errors?: Record<string, string>;
};

type AutofillSnapshot = {
  studyTitle?: string;
  objective?: string;
  keyElements?: string[];
  studyTypeGuess?: string;
  studyGroups?: string[];
  suggestedEffectSize?: number;
  suggestedSampleSize?: number;
  suggestedPrompt?: string;
  sourceLabel?: string;
  blindingProtocolText?: string;
  clinicalDraft?: Partial<ClinicalDraft>;
};

type AssistantChatResponse = AssistantResult & {
  knowledge?: KnowledgeQueryResult | null;
};

type OcrResult = {
  ocrReady: boolean;
  message: string;
  text: string;
  preprocessing: {
    shape: number[];
    mode: string;
  };
};

const isAssistantResult = (value: unknown): value is AssistantResult =>
  value !== null && typeof value === 'object' && 'answer' in value;

const genericKnowledgeAnswerPatterns = [
  /i cannot answer/i,
  /cannot answer based on the provided references/i,
  /no relevant references/i,
  /insufficient references/i,
  /no sufficient evidence/i,
];

const hasGroundedKnowledgeResult = (result: KnowledgeQueryResult) =>
  result.citations.length > 0 || !genericKnowledgeAnswerPatterns.some((pattern) => pattern.test(result.answer));

const sampleSizeTestTypes = [
  'independent_t_test',
  'paired_t_test',
  'two_proportion_z_test',
  'anova',
  'repeated_measures_anova',
] as const;

const createEmptyClinicalDraft = (): ClinicalDraft => ({
  patientAge: '',
  pocketDepthMm: '',
  systolicBpMmhg: '',
  diastolicBpMmhg: '',
  heartRateBpm: '',
  smokingStatus: 'no',
});

const extractClinicalDraftFromText = (text: string): Partial<ClinicalDraft> => {
  const draft: Partial<ClinicalDraft> = {};
  const ageMatch = text.match(/(?:age|العمر)\s*[:=-]?\s*(\d{1,3})/i);
  const pocketDepthMatch = text.match(/(?:ppd|pocket depth|probing depth|عمق الجيب)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i);
  const bloodPressureMatch = text.match(/(?:bp|blood pressure|ضغط الدم)\s*[:=-]?\s*(\d{2,3})\s*\/\s*(\d{2,3})/i);
  const heartRateMatch = text.match(/(?:heart rate|pulse|معدل القلب|النبض)\s*[:=-]?\s*(\d{2,3})/i);
  const smokingMatch = text.match(/(?:smoking status|smoker|smoking|التدخين)\s*[:=-]?\s*(yes|no|نعم|لا)/i);

  if (ageMatch) {
    draft.patientAge = ageMatch[1];
  }
  if (pocketDepthMatch) {
    draft.pocketDepthMm = pocketDepthMatch[1];
  }
  if (bloodPressureMatch) {
    draft.systolicBpMmhg = bloodPressureMatch[1];
    draft.diastolicBpMmhg = bloodPressureMatch[2];
  }
  if (heartRateMatch) {
    draft.heartRateBpm = heartRateMatch[1];
  }
  if (smokingMatch) {
    draft.smokingStatus = smokingMatch[1] === 'نعم' ? 'yes' : smokingMatch[1] === 'لا' ? 'no' : (smokingMatch[1].toLowerCase() as 'yes' | 'no');
  }

  return draft;
};

const toOptionalNumber = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const assistantModes = [
  'protocol_understanding',
  'study_elements',
  'analysis_selection',
  'results_explanation',
  'final_report',
  'researcher_response',
] as const;

const analysisTypes = [
  'auto',
  'dataset_profile',
  'independent_t_test',
  'paired_t_test',
  'chi_square',
  'mann_whitney',
  'wilcoxon',
  'linear_regression',
  'logistic_regression',
  'anova',
  'ancova',
  'survival_analysis',
  'roc_curve',
  'visualization',
] as const;

const chartTypes = ['histogram', 'box_plot', 'scatter'] as const;
const LazyPlotFigure = lazy(() => import('../components/LazyPlotFigure'));

function AIChat() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token, signOut } = useAuth();
  const { t } = useTranslation();
  const [health, setHealth] = useState<AnalyticsHealth | null>(null);
  const [knowledgeHealth, setKnowledgeHealth] = useState<KnowledgeHealth | null>(null);
  const [mode, setMode] = useState<(typeof assistantModes)[number]>('researcher_response');
  const [prompt, setPrompt] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisType, setAnalysisType] = useState<(typeof analysisTypes)[number]>('auto');
  const [useKnowledgeEngine, setUseKnowledgeEngine] = useState(true);
  const [knowledgeDocumentType, setKnowledgeDocumentType] = useState<'reference' | 'research_proposal'>('research_proposal');
  const [knowledgeFilterSource, setKnowledgeFilterSource] = useState('');
  const [knowledgeLimit, setKnowledgeLimit] = useState('5');
  const [sampleSizeTestType, setSampleSizeTestType] = useState<(typeof sampleSizeTestTypes)[number]>('independent_t_test');
  const [sampleSizeEffectSize, setSampleSizeEffectSize] = useState('');
  const [sampleSizeAlpha, setSampleSizeAlpha] = useState('0.05');
  const [sampleSizePower, setSampleSizePower] = useState('0.8');
  const [sampleSizeRatio, setSampleSizeRatio] = useState('1');
  const [sampleSizeAlternative, setSampleSizeAlternative] = useState<'two-sided' | 'larger' | 'smaller'>('two-sided');
  const [sampleSizeApproved, setSampleSizeApproved] = useState(false);
  const [sampleSizeDropoutRate, setSampleSizeDropoutRate] = useState('0.15');
  const [chartType, setChartType] = useState<(typeof chartTypes)[number]>('histogram');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [groupColumn, setGroupColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');
  const [dependentColumn, setDependentColumn] = useState('');
  const [independentColumns, setIndependentColumns] = useState('');
  const [covariates, setCovariates] = useState('');
  const [timeColumn, setTimeColumn] = useState('');
  const [eventColumn, setEventColumn] = useState('');
  const [scoreColumn, setScoreColumn] = useState('');
  const [truthColumn, setTruthColumn] = useState('');
  const [paired, setPaired] = useState(false);
  const [binaryTarget, setBinaryTarget] = useState(false);
  const [fillMissing, setFillMissing] = useState<'none' | 'mean' | 'median'>('none');
  const [datasetProfile, setDatasetProfile] = useState<DatasetProfileResponse | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [assistantResult, setAssistantResult] = useState<AssistantResult | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [knowledgeResult, setKnowledgeResult] = useState<KnowledgeQueryResult | null>(null);
  const [knowledgeIngestResult, setKnowledgeIngestResult] = useState<KnowledgeIngestResult | null>(null);
  const [sampleSizeResult, setSampleSizeResult] = useState<KnowledgeSampleSizeResult | null>(null);
  const [clinicalDraft, setClinicalDraft] = useState<ClinicalDraft>(createEmptyClinicalDraft);
  const [clinicalValidation, setClinicalValidation] = useState<ClinicalValidationResult | null>(null);
  const [autofillSnapshot, setAutofillSnapshot] = useState<AutofillSnapshot | null>(null);
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState(searchParams.get('studyId') ?? '');
  const [persistedFiles, setPersistedFiles] = useState<PersistedStudyFile[]>([]);
  const [persistedAnalyses, setPersistedAnalyses] = useState<PersistedStudyAnalysis[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const acceptedFileLabel = useMemo(() => {
    if (selectedFile) {
      return selectedFile.name;
    }

    return t('aiChat.noFileSelected');
  }, [selectedFile, t]);

  const availableColumns = datasetProfile?.profile.columnNames ?? [];
  const selectedStudy = studies.find((study) => study.id === selectedStudyId) ?? null;

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const buildAnalysisConfig = () => {
    const groupCount =
      datasetProfile?.profile.columnDetails.find((detail) => detail.name === groupColumn)?.unique ?? 0;

    return {
      analysis_type: analysisType,
      chart_type: chartType,
      x_column: xColumn || undefined,
      y_column: yColumn || undefined,
      group_column: groupColumn || undefined,
      value_column: valueColumn || undefined,
      dependent_column: dependentColumn || undefined,
      independent_columns: independentColumns
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      covariates: covariates
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      time_column: timeColumn || undefined,
      event_column: eventColumn || undefined,
      score_column: scoreColumn || undefined,
      truth_column: truthColumn || undefined,
      paired,
      binary_target: binaryTarget,
      group_count: groupCount,
      cleaning: {
        trim_whitespace: true,
        fill_missing: fillMissing === 'none' ? undefined : fillMissing,
      },
      dataset_profile: datasetProfile?.profile,
    };
  };

  const buildKnowledgeStudyContext = () => ({
    ...buildAnalysisConfig(),
    study_metadata: selectedStudy
      ? {
          id: selectedStudy.id,
          title: selectedStudy.title,
          studyType: selectedStudy.studyType,
          status: selectedStudy.status,
        }
      : undefined,
    retrieved_resources: {
      files: persistedFiles.slice(0, 10).map((file) => ({
        id: file.id,
        originalName: file.originalName,
        fileCategory: file.fileCategory,
      })),
      analyses: persistedAnalyses.slice(0, 10).map((analysis) => ({
        id: analysis.id,
        title: analysis.title,
        analysisType: analysis.analysisType,
        createdAt: analysis.createdAt,
      })),
    },
  });

  const authHeaders = token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : undefined;

  const fetchHealth = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/analytics/health`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error('Unable to load analytics health');
      }
      const data = (await response.json()) as AnalyticsHealth;
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }, [token]);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const fetchKnowledgeHealth = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/health`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load knowledge engine health');
      }

      setKnowledgeHealth((await response.json()) as KnowledgeHealth);
    } catch {
      setKnowledgeHealth(null);
    }
  }, [token]);

  useEffect(() => {
    void fetchKnowledgeHealth();
  }, [fetchKnowledgeHealth]);

  const fetchStudies = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/studies`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load studies');
      }

      const data = (await response.json()) as StudyOption[];
      setStudies(data);

    } catch {
      setStudies([]);
    }
  }, [selectedStudyId, token]);

  useEffect(() => {
    void fetchStudies();
  }, [fetchStudies]);

  const fetchStudyResources = useCallback(async () => {
    if (!token || !selectedStudyId) {
      setPersistedFiles([]);
      setPersistedAnalyses([]);
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/resources`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load study resources');
      }

      const data = (await response.json()) as StudyResourcesResponse;
      setPersistedFiles(data.files ?? []);
      setPersistedAnalyses(data.analyses ?? []);
    } catch {
      setPersistedFiles([]);
      setPersistedAnalyses([]);
    }
  }, [selectedStudyId, token]);

  useEffect(() => {
    void fetchStudyResources();
  }, [fetchStudyResources]);

  const mergeAutofillSnapshot = useCallback((value: Partial<AutofillSnapshot>) => {
    setAutofillSnapshot((current) => ({
      ...(current ?? {}),
      ...value,
      clinicalDraft: {
        ...(current?.clinicalDraft ?? {}),
        ...(value.clinicalDraft ?? {}),
      },
    }));
  }, []);

  const applyDatasetAutofill = useCallback(
    (profile: DatasetProfile) => {
      const firstCategorical = profile.categoricalColumns[0] ?? '';
      const secondCategorical = profile.categoricalColumns[1] ?? '';
      const firstNumeric = profile.numericColumns[0] ?? '';
      const secondNumeric = profile.numericColumns[1] ?? firstNumeric;

      if (!groupColumn && firstCategorical) {
        setGroupColumn(firstCategorical);
      }
      if (!valueColumn && firstNumeric) {
        setValueColumn(firstNumeric);
      }
      if (!xColumn && firstNumeric) {
        setXColumn(firstNumeric);
      }
      if (!yColumn && secondNumeric) {
        setYColumn(secondNumeric);
      }
      if (!dependentColumn && firstNumeric) {
        setDependentColumn(firstNumeric);
      }
      if (!scoreColumn && firstNumeric) {
        setScoreColumn(firstNumeric);
      }
      if (!eventColumn && secondCategorical) {
        setEventColumn(secondCategorical);
      }
      if (!truthColumn && secondCategorical) {
        setTruthColumn(secondCategorical);
      }
      if (!groupColumn && firstCategorical && !prompt.trim()) {
        setPrompt(`حلل ملف الدراسة باستخدام ${firstCategorical} كمجموعة و${firstNumeric || 'القيمة الأساسية'} كمخرج رئيسي.`);
      }
    },
    [dependentColumn, eventColumn, groupColumn, prompt, scoreColumn, truthColumn, valueColumn, xColumn, yColumn],
  );

  const handleProfileDataset = async () => {
    if (!selectedFile || !authHeaders) {
      setError(t('aiChat.errors.fileRequired'));
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append(
        'options',
        JSON.stringify({
          trim_whitespace: true,
          fill_missing: fillMissing === 'none' ? undefined : fillMissing,
        }),
      );

      const response = await fetch(`${apiBaseUrl}/analytics/profile`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to profile dataset');
      }

      const data = (await response.json()) as DatasetProfileResponse;
      setDatasetProfile(data);
      applyDatasetAutofill(data.profile);
    } catch {
      setError(t('aiChat.errors.profileFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadStudyFile = async () => {
    if (!selectedFile || !authHeaders) {
      setError(t('aiChat.errors.fileRequired'));
      return;
    }

    if (!selectedStudyId) {
      setError('اختر دراسة أولاً إذا أردت حفظ الملف داخل موارد الدراسة.');
      return;
    }
    if (selectedStudy?.isLocked) {
      setError('الدراسة الحالية مقفلة للتقييم الخارجي، لذلك لا يمكن رفع ملف جديد داخلها.');
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/files`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to upload study file');
      }

      await fetchStudyResources();
    } catch {
      setError(t('aiChat.errors.uploadFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRecommendAnalysis = async () => {
    if (!authHeaders) {
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const response = await fetch(`${apiBaseUrl}/analytics/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(buildAnalysisConfig()),
      });

      if (!response.ok) {
        throw new Error('Unable to recommend analysis');
      }

      const data = (await response.json()) as AnalysisResult['recommended'];
      setAnalysisResult((prev) => ({
        ...(prev ?? {}),
        recommended: data,
      }));
    } catch {
      setError(t('aiChat.errors.recommendationFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunAnalysis = async () => {
    if (!selectedFile || !authHeaders) {
      setError(t('aiChat.errors.fileRequired'));
      return;
    }
    if (selectedStudyId && selectedStudy?.isLocked) {
      setError('الدراسة الحالية مقفلة، ويمكنك تشغيل التحليل في الوضع الخارجي فقط بدون حفظه داخل الدراسة.');
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('config', JSON.stringify(buildAnalysisConfig()));
      formData.append('prompt', prompt);
      formData.append('mode', mode);
      formData.append('title', prompt.trim() ? prompt.trim().slice(0, 80) : `${selectedStudy?.title ?? 'Study'} analysis`);

      const response = await fetch(
        selectedStudyId ? `${apiBaseUrl}/studies/${selectedStudyId}/analysis/run` : `${apiBaseUrl}/analytics/run`,
        {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error('Unable to run analysis');
      }

      const data = (await response.json()) as
        | {
            file: PersistedStudyFile;
            analysis: AnalysisResult & PersistedStudyAnalysis;
          }
        | AnalysisResult;
      const nextAnalysis: AnalysisResult = selectedStudyId
        ? (data as { file: PersistedStudyFile; analysis: AnalysisResult & PersistedStudyAnalysis }).analysis
        : (data as AnalysisResult);
      setAnalysisResult(nextAnalysis);
      if (nextAnalysis.profile) {
        setDatasetProfile({
          profile: nextAnalysis.profile,
          cleaningApplied: {},
        });
        applyDatasetAutofill(nextAnalysis.profile);
      }
      if (isAssistantResult(nextAnalysis.assistant)) {
        setAssistantResult(nextAnalysis.assistant as AssistantResult);
      }
      if (nextAnalysis.ocr && typeof nextAnalysis.ocr === 'object') {
        setOcrResult(nextAnalysis.ocr as OcrResult);
      }
      if (selectedStudyId) {
        await fetchStudyResources();
      }
    } catch {
      setError(t('aiChat.errors.analysisFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunOcr = async () => {
    if (!selectedFile || !authHeaders) {
      setError(t('aiChat.errors.fileRequired'));
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${apiBaseUrl}/analytics/ocr`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to run OCR');
      }

      const data = (await response.json()) as OcrResult;
      if (data.text) {
        const extractedClinicalDraft = extractClinicalDraftFromText(data.text);
        setClinicalDraft((current) => ({
          ...current,
          ...extractedClinicalDraft,
        }));
        mergeAutofillSnapshot({
          sourceLabel: selectedFile?.name || 'OCR',
          suggestedPrompt: prompt.trim() || data.text.slice(0, 1200),
          clinicalDraft: extractedClinicalDraft,
        });
        if (!prompt.trim()) {
          setPrompt(data.text.slice(0, 1200));
        }
      }
      setOcrResult(data);
    } catch {
    } finally {
      setIsBusy(false);
    }
  };

  const handleAssistant = async () => {
    if (!prompt.trim() || !authHeaders) {
      setError(t('aiChat.errors.promptRequired'));
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const response = await fetch(`${apiBaseUrl}/analytics/assistant/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          mode,
          prompt,
          protocol_text: prompt,
          useKnowledgeEngine,
          knowledgeFilterSource: knowledgeFilterSource || undefined,
          knowledgeLimit: Number(knowledgeLimit) || 5,
          dataset_profile: datasetProfile?.profile,
          statistical_result: analysisResult,
          study_context: buildKnowledgeStudyContext(),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to use assistant');
      }

      const data = (await response.json()) as AssistantChatResponse;
      setAssistantResult(data);
      if (data.knowledge) {
        setKnowledgeResult(data.knowledge);
      }
      if (data.extractedStudyElements) {
        mergeAutofillSnapshot({
          studyTitle: data.extractedStudyElements.title,
          objective: data.extractedStudyElements.objective,
          keyElements: data.extractedStudyElements.keyElements,
          studyTypeGuess: data.extractedStudyElements.studyTypeGuess,
          suggestedPrompt: prompt,
          sourceLabel: selectedFile?.name || selectedStudy?.title || 'Assistant',
        });
      }
    } catch {
      setError(t('aiChat.errors.assistantFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleKnowledgeIngest = async () => {
    if (!selectedFile || !authHeaders) {
      setError(t('aiChat.errors.fileRequired'));
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('document_type', knowledgeDocumentType);

      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/ingest`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to ingest document');
      }

      const data = (await response.json()) as KnowledgeIngestResult;
      setKnowledgeIngestResult(data);
      setKnowledgeFilterSource(data.filename);
      if (knowledgeDocumentType === 'research_proposal') {
        const suggestedPromptParts = [
          `حلل هذا المقترح البحثي: ${data.filename}.`,
          data.study_groups?.length ? `المجموعات المستخرجة: ${data.study_groups.join('، ')}.` : '',
          typeof data.extracted_effect_size === 'number' ? `حجم الأثر المقترح من المرجع: ${data.extracted_effect_size}.` : '',
        ].filter(Boolean);
        const nextPrompt = suggestedPromptParts.join(' ');
        if (nextPrompt) {
          setPrompt(nextPrompt);
        }
        if (typeof data.extracted_effect_size === 'number') {
          setSampleSizeEffectSize(String(data.extracted_effect_size));
        }
        mergeAutofillSnapshot({
          studyGroups: data.study_groups ?? undefined,
          suggestedEffectSize: data.extracted_effect_size ?? undefined,
          suggestedPrompt: nextPrompt,
          sourceLabel: data.filename,
        });
        setMode('study_elements');
      }
    } catch {
      setError('تعذر فهرسة الملف داخل المكتبة المعرفية.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleKnowledgeQuery = async () => {
    if (!prompt.trim() || !authHeaders) {
      setError(t('aiChat.errors.promptRequired'));
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          question: prompt,
          mode,
          filter_source: knowledgeFilterSource || undefined,
          limit: Number(knowledgeLimit) || 5,
          protocol_text: prompt,
          study_context: buildKnowledgeStudyContext(),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to query knowledge engine');
      }

      setKnowledgeResult((await response.json()) as KnowledgeQueryResult);
    } catch {
      setError('تعذر تنفيذ الاستعلام المعرفي الموثق.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSampleSizeCalculation = async () => {
    if (!authHeaders) {
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/sample-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          test_type: sampleSizeTestType,
          effect_size: toOptionalNumber(sampleSizeEffectSize),
          alpha: Number(sampleSizeAlpha || 0.05),
          power: Number(sampleSizePower || 0.8),
          ratio: Number(sampleSizeRatio || 1),
          alternative: sampleSizeAlternative,
          approved: sampleSizeApproved,
          dropout_rate: Number(sampleSizeDropoutRate || 0.15),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to calculate sample size');
      }

      const data = (await response.json()) as KnowledgeSampleSizeResult;
      setSampleSizeResult(data);
      if (!sampleSizeEffectSize && typeof data.proposed_effect_size === 'number') {
        setSampleSizeEffectSize(String(data.proposed_effect_size));
      }
    } catch {
      setError('تعذر تنفيذ حساب حجم العينة عبر المكتبة المعرفية.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleClinicalValidation = async () => {
    if (!authHeaders) {
      return;
    }

    const patientAge = toOptionalNumber(clinicalDraft.patientAge);
    const pocketDepthMm = toOptionalNumber(clinicalDraft.pocketDepthMm);
    if (patientAge === undefined || pocketDepthMm === undefined) {
      setError('أدخل العمر وعمق الجيب أو استخرجهما من OCR قبل التحقق السريري.');
      return;
    }

    try {
      setError('');
      setIsBusy(true);
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/validate-clinical`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          patient_age: patientAge,
          pocket_depth_mm: pocketDepthMm,
          systolic_bp_mmhg: toOptionalNumber(clinicalDraft.systolicBpMmhg),
          diastolic_bp_mmhg: toOptionalNumber(clinicalDraft.diastolicBpMmhg),
          heart_rate_bpm: toOptionalNumber(clinicalDraft.heartRateBpm),
          smoking_status: clinicalDraft.smokingStatus,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to validate clinical parameters');
      }

      setClinicalValidation((await response.json()) as ClinicalValidationResult);
    } catch {
      setError('تعذر تنفيذ التحقق السريري من البيانات المستخرجة.');
    } finally {
      setIsBusy(false);
    }
  };

  const pushAutofillToStudyFlow = (target: 'new-study' | 'current-study') => {
    if (!autofillSnapshot) {
      setError('لا توجد بيانات مستخرجة جاهزة للإرسال إلى مسار الدراسة.');
      return;
    }

    const snapshot = {
      ...autofillSnapshot,
      suggestedSampleSize: sampleSizeResult?.total_sample_size ?? autofillSnapshot.suggestedSampleSize,
      studyTypeGuess: assistantResult?.extractedStudyElements?.studyTypeGuess ?? autofillSnapshot.studyTypeGuess,
      blindingProtocolText:
        mode === 'protocol_understanding' || mode === 'study_elements'
          ? assistantResult?.answer ?? autofillSnapshot.blindingProtocolText
          : autofillSnapshot.blindingProtocolText,
      savedAt: new Date().toISOString(),
    };

    saveAutofillSnapshot(snapshot);

    if (target === 'new-study') {
      navigate('/studies?create=1&workflow=supervised&autofill=1');
      return;
    }

    if (!selectedStudyId) {
      setError('اختر دراسة أولاً قبل تطبيق الـ auto-fill على دراسة قائمة.');
      return;
    }

    navigate(`/studies/${selectedStudyId}?tab=overview&autofill=1`);
  };

  const metrics = [
    {
      label: t('aiChat.metrics.analyticsEngine'),
      value: health ? t('aiChat.metrics.available') : t('aiChat.metrics.unavailable'),
      icon: Activity,
    },
    {
      label: t('aiChat.metrics.llmStatus'),
      value: health?.openaiConfigured ? `${health.openaiModel}` : t('aiChat.metrics.fallback'),
      icon: Brain,
    },
    {
      label: t('aiChat.metrics.dataPipelines'),
      value: health ? Object.keys(health.libraries).length.toString() : '0',
      icon: FileSearch,
    },
    {
      label: 'Knowledge Engine',
      value: knowledgeHealth ? 'Connected' : 'Unavailable',
      icon: Bot,
    },
  ] as const;

  const handleOpenReport = (analysisId: string) => {
    if (!token || !selectedStudyId) {
      return;
    }

    void (async () => {
      try {
        setError('');
        setIsBusy(true);

        const response = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/analyses/${analysisId}/report`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Unable to download report');
        }

        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${selectedStudy?.title ?? 'study-analysis'}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(objectUrl);
      } catch {
        setError(t('aiChat.errors.analysisFailed'));
      } finally {
        setIsBusy(false);
      }
    })();
  };

  return (
    <ResearchWorkspaceShell
      title={t('aiChat.title')}
      subtitle={t('aiChat.workspaceSubtitle')}
      currentStudyLabel={selectedStudy ? `${selectedStudy.title} • ${selectedStudy.studyType}` : 'Statistical Analysis Workspace'}
      navItems={buildResearchWorkspaceNav(selectedStudyId || undefined).map((item) => ({
        ...item,
        active: item.key === 'analysis',
      }))}
      actions={
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" />
          {t('dashboard.common.logout')}
        </button>
      }
    >
      <div className="space-y-6">
        <div className="rounded-3xl bg-gradient-to-l from-indigo-950 via-indigo-900 to-teal-950 p-6 text-white shadow-card">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-extrabold text-teal-100">Reports & AI Workspace</p>
              <h2 className="mt-2 text-3xl font-black">{selectedStudy ? selectedStudy.title : 'External Statistical Analysis'}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-200">
                مساحة تقارير وتحليل موحدة لرفع الملفات، تشخيص البيانات، تشغيل التحليل الإحصائي، وإصدار مخرجات الذكاء الاصطناعي والتقارير النهائية.
              </p>
            </div>
            <div className="grid min-w-[280px] gap-3">
              <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-100">
                {selectedStudy ? `${selectedStudy.studyType} • ${selectedStudy.status}` : 'Standalone analysis mode'}
              </div>
              {user ? (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-100">
                  {user.fullName ?? t('dashboard.common.fallbackResearcher')}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="workspace-card p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                  <metric.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{metric.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-6">
            <div className="workspace-card p-6">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{t('aiChat.controlPanel')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('aiChat.controlPanelDescription')}</p>
                </div>
                <div className="prototype-chip active">AI Ready</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.study')}</label>
                  <select
                    value={selectedStudyId}
                    onChange={(event) => setSelectedStudyId(event.target.value)}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('aiChat.fields.studyPlaceholder')}</option>
                    {studies.map((study) => (
                      <option key={study.id} value={study.id}>
                        {study.title} • {study.studyType}
                        {study.isLocked ? ' • Locked' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm text-slate-500">
                    {selectedStudy ? `${selectedStudy.studyType} • ${selectedStudy.status}` : 'يمكنك ترك الدراسة فارغة لاستخدام التحليل الخارجي فقط.'}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.mode')}</label>
                  <select value={mode} onChange={(event) => setMode(event.target.value as (typeof assistantModes)[number])} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {assistantModes.map((item) => (
                      <option key={item} value={item}>
                        {t(`aiChat.modes.${item}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.analysisType')}</label>
                  <select value={analysisType} onChange={(event) => setAnalysisType(event.target.value as (typeof analysisTypes)[number])} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {analysisTypes.map((item) => (
                      <option key={item} value={item}>
                        {t(`aiChat.analysisTypes.${item}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="inline-flex items-center gap-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={useKnowledgeEngine} onChange={(event) => setUseKnowledgeEngine(event.target.checked)} />
                    <span>ربط الشات بالمكتبة المعرفية والاستشهادات</span>
                  </label>
                  <p className="mt-2 text-xs text-slate-500">عند التفعيل سيستخدم المساعد إجابة موثقة بالمراجع من الـ Knowledge Engine قبل توليد الرد.</p>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.prompt')}</label>
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder={t('aiChat.placeholder')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.file')}</label>
                  <div className="prototype-dropzone rounded-3xl p-5">
                    <input type="file" accept=".csv,.xlsx,.xls,.sav,.png,.jpg,.jpeg,.webp,.gif,.pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">{acceptedFileLabel}</p>
                    <p className="mt-1 text-xs text-slate-500">CSV / XLSX / SAV / PDF / Images</p>
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="hidden" />
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={() => cameraInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        التقاط صورة من الهاتف
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUploadStudyFile()}
                        disabled={!selectedStudyId}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t('aiChat.actions.uploadToStudy')}
                      </button>
                      <button type="button" onClick={() => void handleKnowledgeIngest()} className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100">
                        فهرسة الملف في المكتبة
                      </button>
                    </div>
                  </div>
                </div>

                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.groupColumn')}</label><input value={groupColumn} onChange={(event) => setGroupColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.valueColumn')}</label><input value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.xColumn')}</label><input value={xColumn} onChange={(event) => setXColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.yColumn')}</label><input value={yColumn} onChange={(event) => setYColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.dependentColumn')}</label><input value={dependentColumn} onChange={(event) => setDependentColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.independentColumns')}</label><input value={independentColumns} onChange={(event) => setIndependentColumns(event.target.value)} placeholder={t('aiChat.placeholders.csvColumns')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.covariates')}</label><input value={covariates} onChange={(event) => setCovariates(event.target.value)} placeholder={t('aiChat.placeholders.csvColumns')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.chartType')}</label><select value={chartType} onChange={(event) => setChartType(event.target.value as (typeof chartTypes)[number])} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500">{chartTypes.map((item) => <option key={item} value={item}>{t(`aiChat.chartTypes.${item}`)}</option>)}</select></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.timeColumn')}</label><input value={timeColumn} onChange={(event) => setTimeColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.eventColumn')}</label><input value={eventColumn} onChange={(event) => setEventColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.scoreColumn')}</label><input value={scoreColumn} onChange={(event) => setScoreColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.truthColumn')}</label><input value={truthColumn} onChange={(event) => setTruthColumn(event.target.value)} list="available-columns" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="mb-2 block text-sm font-medium text-slate-700">{t('aiChat.fields.fillMissing')}</label><select value={fillMissing} onChange={(event) => setFillMissing(event.target.value as 'none' | 'mean' | 'median')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="none">{t('aiChat.fillMissing.none')}</option><option value="mean">{t('aiChat.fillMissing.mean')}</option><option value="median">{t('aiChat.fillMissing.median')}</option></select></div>
                <div className="flex flex-col justify-end gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="inline-flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={paired} onChange={(event) => setPaired(event.target.checked)} /><span>{t('aiChat.fields.paired')}</span></label>
                  <label className="inline-flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={binaryTarget} onChange={(event) => setBinaryTarget(event.target.checked)} /><span>{t('aiChat.fields.binaryTarget')}</span></label>
                </div>
              </div>

              <datalist id="available-columns">
                {availableColumns.map((column) => (
                  <option key={column} value={column} />
                ))}
              </datalist>

              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => void handleProfileDataset()} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('aiChat.actions.profile')}</button>
                <button type="button" onClick={() => void handleRecommendAnalysis()} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('aiChat.actions.recommend')}</button>
                <button type="button" onClick={() => void handleRunAnalysis()} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">{t('aiChat.actions.runAnalysis')}</button>
                <button type="button" onClick={() => void handleRunOcr()} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('aiChat.actions.runOcr')}</button>
                <button type="button" onClick={() => void handleKnowledgeQuery()} className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100">استعلام معرفي موثق</button>
                <button type="button" onClick={() => void handleAssistant()} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-3 text-sm font-medium text-white hover:shadow-lg">
                  <Send className="h-4 w-4" />
                  {t('aiChat.actions.askAssistant')}
                </button>
              </div>

              {isBusy ? (
                <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t('aiChat.processing')}
                </div>
              ) : null}

              {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
            </div>

            <div className="workspace-card p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Knowledge, Auto-fill & Validation</h2>
                  <p className="mt-1 text-sm text-slate-500">فهرسة المقترح أو المرجع، تعبئة ذكية، حساب حجم العينة، والتحقق من الحقول السريرية.</p>
                </div>
                <div className={`prototype-chip ${knowledgeHealth ? 'active' : ''}`}>{knowledgeHealth ? 'Connected' : 'Offline'}</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">نوع الملف المعرفي</label>
                  <select value={knowledgeDocumentType} onChange={(event) => setKnowledgeDocumentType(event.target.value as 'reference' | 'research_proposal')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="research_proposal">Research proposal</option>
                    <option value="reference">Clinical reference</option>
                  </select>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">تصفية المصدر المرجعي</label>
                  <input value={knowledgeFilterSource} onChange={(event) => setKnowledgeFilterSource(event.target.value)} placeholder="اسم ملف مرجعي محدد إن وجد" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">عدد المقاطع المرجعية</label>
                  <input value={knowledgeLimit} onChange={(event) => setKnowledgeLimit(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">اختبار حجم العينة</label>
                  <select value={sampleSizeTestType} onChange={(event) => setSampleSizeTestType(event.target.value as (typeof sampleSizeTestTypes)[number])} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500">
                    {sampleSizeTestTypes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">Effect size</label>
                  <input value={sampleSizeEffectSize} onChange={(event) => setSampleSizeEffectSize(event.target.value)} placeholder="مثال: 0.35" className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Alpha</label>
                    <input value={sampleSizeAlpha} onChange={(event) => setSampleSizeAlpha(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Power</label>
                    <input value={sampleSizePower} onChange={(event) => setSampleSizePower(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Ratio</label>
                    <input value={sampleSizeRatio} onChange={(event) => setSampleSizeRatio(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Dropout</label>
                    <input value={sampleSizeDropoutRate} onChange={(event) => setSampleSizeDropoutRate(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <label className="mb-2 block text-sm font-medium text-slate-700">Alternative hypothesis</label>
                  <select value={sampleSizeAlternative} onChange={(event) => setSampleSizeAlternative(event.target.value as 'two-sided' | 'larger' | 'smaller')} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="two-sided">two-sided</option>
                    <option value="larger">larger</option>
                    <option value="smaller">smaller</option>
                  </select>
                  <label className="mt-3 inline-flex items-center gap-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={sampleSizeApproved} onChange={(event) => setSampleSizeApproved(event.target.checked)} />
                    <span>اعتماد القيم وتنفيذ الحساب النهائي</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 md:col-span-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Patient age</label>
                    <input value={clinicalDraft.patientAge} onChange={(event) => setClinicalDraft((current) => ({ ...current, patientAge: event.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Pocket depth (mm)</label>
                    <input value={clinicalDraft.pocketDepthMm} onChange={(event) => setClinicalDraft((current) => ({ ...current, pocketDepthMm: event.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Systolic BP</label>
                    <input value={clinicalDraft.systolicBpMmhg} onChange={(event) => setClinicalDraft((current) => ({ ...current, systolicBpMmhg: event.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Diastolic BP</label>
                    <input value={clinicalDraft.diastolicBpMmhg} onChange={(event) => setClinicalDraft((current) => ({ ...current, diastolicBpMmhg: event.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Heart rate</label>
                    <input value={clinicalDraft.heartRateBpm} onChange={(event) => setClinicalDraft((current) => ({ ...current, heartRateBpm: event.target.value }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Smoking</label>
                    <select value={clinicalDraft.smokingStatus} onChange={(event) => setClinicalDraft((current) => ({ ...current, smokingStatus: event.target.value as 'yes' | 'no' }))} className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500">
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => void handleSampleSizeCalculation()} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700">حساب حجم العينة</button>
                <button type="button" onClick={() => void handleClinicalValidation()} className="rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 text-sm font-medium text-purple-700 hover:bg-purple-100">تحقق سريري من الحقول</button>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="workspace-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">AI Overlay</h2>
                  <p className="text-sm text-slate-500">ملخص الحالة التشغيلية، الملفات المرجعية، والتقارير الناتجة</p>
                </div>
              </div>
              {health ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.model')}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{health.openaiModel}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.llmConnection')}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{health.openaiConfigured ? t('aiChat.metrics.connected') : t('aiChat.metrics.fallback')}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{t('aiChat.results.serviceUnavailable')}</div>
              )}
            </div>

            {autofillSnapshot ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">Auto-fill Snapshot</h2>
                <p className="mt-1 text-sm text-slate-500">ملخص تعبئة تلقائية مبني على OCR واستخراج عناصر الدراسة ونتائج فهرسة المقترح.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{autofillSnapshot.sourceLabel ?? 'Workspace'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested Effect Size</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{autofillSnapshot.suggestedEffectSize ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested Sample Size</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {sampleSizeResult?.total_sample_size ?? autofillSnapshot.suggestedSampleSize ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Study Type Guess</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{autofillSnapshot.studyTypeGuess ?? '—'}</p>
                  </div>
                </div>
                {autofillSnapshot.studyTitle || autofillSnapshot.objective ? (
                  <div className="mt-4 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900 ring-1 ring-teal-100">
                    {autofillSnapshot.studyTitle ? <p className="font-semibold">{autofillSnapshot.studyTitle}</p> : null}
                    {autofillSnapshot.objective ? <p className="mt-2">{autofillSnapshot.objective}</p> : null}
                    {autofillSnapshot.studyGroups?.length ? <p className="mt-2">المجموعات المقترحة: {autofillSnapshot.studyGroups.join('، ')}</p> : null}
                  </div>
                ) : null}
                {autofillSnapshot.keyElements?.length ? (
                  <ul className="mt-4 space-y-2 text-sm text-slate-600">
                    {autofillSnapshot.keyElements.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                ) : null}
                {autofillSnapshot.clinicalDraft ? (
                  <div className="mt-4 rounded-2xl bg-purple-50 p-4 text-sm text-purple-900 ring-1 ring-purple-100">
                    <p className="font-semibold">Clinical fields auto-filled from OCR</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <p>Age: {autofillSnapshot.clinicalDraft.patientAge || '—'}</p>
                      <p>Pocket depth: {autofillSnapshot.clinicalDraft.pocketDepthMm || '—'}</p>
                      <p>BP: {autofillSnapshot.clinicalDraft.systolicBpMmhg || '—'} / {autofillSnapshot.clinicalDraft.diastolicBpMmhg || '—'}</p>
                      <p>Heart rate: {autofillSnapshot.clinicalDraft.heartRateBpm || '—'}</p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => pushAutofillToStudyFlow('new-study')}
                    className="rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white hover:bg-teal-700"
                  >
                    تطبيق على دراسة جديدة
                  </button>
                  <button
                    type="button"
                    onClick={() => pushAutofillToStudyFlow('current-study')}
                    disabled={!selectedStudyId}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    تطبيق على الدراسة الحالية
                  </button>
                </div>
              </div>
            ) : null}

            {knowledgeIngestResult ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">Knowledge Indexing</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">File</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{knowledgeIngestResult.filename}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence Rank</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {knowledgeIngestResult.evidence_rank} • {knowledgeIngestResult.evidence_level_label}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-100">
                  <p>{knowledgeIngestResult.message}</p>
                  <p className="mt-2">Chunks processed: {knowledgeIngestResult.chunks_processed}</p>
                  <p className="mt-1">Primary reference: {knowledgeIngestResult.is_primary_reference ? 'Yes' : 'No'}</p>
                  {knowledgeIngestResult.study_groups?.length ? <p className="mt-1">Study groups: {knowledgeIngestResult.study_groups.join('، ')}</p> : null}
                </div>
              </div>
            ) : null}

            <div className="workspace-card p-6">
              <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.studyResources')}</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <p className="text-sm font-semibold text-slate-800">{t('aiChat.results.savedFiles')}</p>
                  {persistedFiles.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">{t('aiChat.results.noSavedFiles')}</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600">
                      {persistedFiles.slice(0, 6).map((file) => (
                        <li key={file.id}>
                          {file.originalName} • {file.fileCategory}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <p className="text-sm font-semibold text-slate-800">{t('aiChat.results.savedAnalyses')}</p>
                  {persistedAnalyses.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">{t('aiChat.results.noSavedAnalyses')}</p>
                  ) : (
                    <div className="mt-3 space-y-3 text-sm text-slate-600">
                      {persistedAnalyses.slice(0, 6).map((analysis) => (
                        <div key={analysis.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                          <p className="font-medium text-slate-900">{analysis.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{analysis.analysisType ?? t('aiChat.results.unspecifiedAnalysis')}</p>
                          <button type="button" onClick={() => handleOpenReport(analysis.id)} className="mt-2 text-sm font-medium text-indigo-600 hover:underline">
                            {t('aiChat.actions.downloadPdf')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {datasetProfile ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.datasetProfile')}</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.rows')}</p><p className="mt-2 text-lg font-bold text-slate-900">{datasetProfile.profile.rows}</p></div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.columns')}</p><p className="mt-2 text-lg font-bold text-slate-900">{datasetProfile.profile.columns}</p></div>
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.missingFields')}</p><p className="mt-2 text-lg font-bold text-slate-900">{Object.keys(datasetProfile.profile.missingValues).length}</p></div>
                </div>
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <p className="text-sm font-semibold text-slate-900">{t('aiChat.results.suggestions')}</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {datasetProfile.profile.suggestions.map((suggestion) => (
                      <li key={suggestion}>- {suggestion}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {analysisResult ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.analysis')}</h2>
                {analysisResult.recommended ? (
                  <div className="mt-4 rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-900 ring-1 ring-indigo-100">
                    <p className="font-semibold">{t('aiChat.results.recommendedTest')}: {analysisResult.recommended.recommended_test}</p>
                    <p className="mt-1">{analysisResult.recommended.reason}</p>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {analysisResult.analysis ? <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.analysisType')}</p><p className="mt-2 font-semibold text-slate-900">{analysisResult.analysis}</p></div> : null}
                  {typeof analysisResult.pValue === 'number' ? <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">P-value</p><p className="mt-2 font-semibold text-slate-900">{analysisResult.pValue}</p></div> : null}
                  {typeof analysisResult.statistic === 'number' ? <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('aiChat.results.testStatistic')}</p><p className="mt-2 font-semibold text-slate-900">{analysisResult.statistic}</p></div> : null}
                  {typeof analysisResult.auc === 'number' ? <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AUC</p><p className="mt-2 font-semibold text-slate-900">{analysisResult.auc}</p></div> : null}
                </div>
                {analysisResult.summaryText ? <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-sm text-slate-100"><pre className="whitespace-pre-wrap">{analysisResult.summaryText}</pre></div> : null}
                {analysisResult.figure ? (
                  <div className="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                    <Suspense fallback={<div className="flex min-h-[420px] items-center justify-center text-slate-600"><div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>{t('studies.messages.loading')}</span></div></div>}>
                      <LazyPlotFigure figure={analysisResult.figure} />
                    </Suspense>
                  </div>
                ) : null}
              </div>
            ) : null}

            {assistantResult ? (
              <div className="workspace-card p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.assistant')}</h2>
                    <p className="text-sm text-slate-500">{assistantResult.usedLLM ? assistantResult.model : t('aiChat.results.fallbackAssistant')}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200"><pre className="whitespace-pre-wrap">{assistantResult.answer}</pre></div>
                {assistantResult.extractedStudyElements ? (
                  <div className="mt-4 rounded-2xl bg-teal-50 p-4 text-sm text-teal-900 ring-1 ring-teal-100">
                    <p className="font-semibold">{assistantResult.extractedStudyElements.title}</p>
                    <p className="mt-2">{assistantResult.extractedStudyElements.objective}</p>
                    {assistantResult.extractedStudyElements.keyElements?.length ? (
                      <ul className="mt-3 space-y-2">
                        {assistantResult.extractedStudyElements.keyElements.map((item) => (
                          <li key={item}>- {item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {knowledgeResult ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">Knowledge Answer</h2>
                {knowledgeResult.error ? (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{knowledgeResult.error}</div>
                ) : (
                  <>
                    {knowledgeResult.retrieval?.notice ? (
                      <div className={`mt-4 rounded-2xl border p-4 text-sm ${
                        hasGroundedKnowledgeResult(knowledgeResult)
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        <p className="font-semibold">
                          {knowledgeResult.retrieval.fallbackApplied ? 'تم توسيع نطاق البحث تلقائياً' : 'حالة الاسترجاع المعرفي'}
                        </p>
                        <p className="mt-1">{knowledgeResult.retrieval.notice}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="rounded-full bg-white/70 px-3 py-1 ring-1 ring-current/10">
                            Strategy: {knowledgeResult.retrieval.strategy}
                          </span>
                          <span className="rounded-full bg-white/70 px-3 py-1 ring-1 ring-current/10">
                            Attempts: {knowledgeResult.retrieval.attempts.length}
                          </span>
                          <span className="rounded-full bg-white/70 px-3 py-1 ring-1 ring-current/10">
                            Citations: {knowledgeResult.citations.length}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                      <pre className="whitespace-pre-wrap">{knowledgeResult.answer}</pre>
                    </div>
                    {knowledgeResult.retrieval?.attempts.length ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        {knowledgeResult.retrieval.attempts.map((attempt) => (
                          <div
                            key={attempt.label}
                            className={`rounded-2xl border p-4 text-sm ${
                              attempt.useful
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                : 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                          >
                            <p className="font-semibold">{attempt.label}</p>
                            <p className="mt-2 text-xs">
                              Source: {attempt.filterSource || 'all indexed references'}
                            </p>
                            <p className="mt-1 text-xs">Citations: {attempt.citationCount}</p>
                            <p className="mt-1 text-xs">{attempt.useful ? 'Grounded answer found' : 'No grounded evidence returned'}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      {knowledgeResult.citations.map((citation, index) => (
                        <div key={`${citation.source_file}-${citation.page}-${index}`} className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                          <p className="font-semibold">{citation.source_file} • Page {citation.page}</p>
                          <p className="mt-1 text-xs">{citation.section}</p>
                          <p className="mt-2">{citation.quoted_text}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {sampleSizeResult ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">Sample Size Engine</h2>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                  <p className="font-semibold">{sampleSizeResult.message}</p>
                  {sampleSizeResult.test_used ? <p className="mt-2">Test: {sampleSizeResult.test_used}</p> : null}
                  {typeof sampleSizeResult.proposed_effect_size === 'number' ? <p className="mt-1">Proposed effect size: {sampleSizeResult.proposed_effect_size}</p> : null}
                  {typeof sampleSizeResult.total_sample_size === 'number' ? <p className="mt-1">Total sample size: {sampleSizeResult.total_sample_size}</p> : null}
                  {sampleSizeResult.interpretation ? <p className="mt-3 whitespace-pre-wrap">{sampleSizeResult.interpretation}</p> : null}
                </div>
                {sampleSizeResult.scenarios?.length ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {sampleSizeResult.scenarios.map((scenario) => (
                      <div key={scenario.label} className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-100">
                        <p className="font-semibold">{scenario.label}</p>
                        <p className="mt-2">Effect size: {scenario.effect_size}</p>
                        <p className="mt-1">Adjusted / group: {scenario.adjusted_n_per_group}</p>
                        <p className="mt-1">Total: {scenario.total_sample_size}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {clinicalValidation ? (
              <div className="workspace-card p-6">
                <h2 className="text-xl font-bold text-slate-900">Clinical Validation</h2>
                {clinicalValidation.valid ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    جميع القيم السريرية الحالية ضمن النطاقات البيولوجية المقبولة.
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    <p className="font-semibold">تم اكتشاف حقول تحتاج مراجعة:</p>
                    <ul className="mt-3 space-y-2">
                      {Object.entries(clinicalValidation.errors ?? {}).map(([key, value]) => (
                        <li key={key}>
                          <span className="font-semibold">{key}:</span> {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {ocrResult ? (
              <div className="workspace-card p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-purple-50 p-3 text-purple-600">
                    <ScanText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.ocr')}</h2>
                    <p className="text-sm text-slate-500">{ocrResult.message}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                  <pre className="whitespace-pre-wrap">{ocrResult.text || t('aiChat.results.noOcrText')}</pre>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </ResearchWorkspaceShell>
  );
}

export default AIChat;
