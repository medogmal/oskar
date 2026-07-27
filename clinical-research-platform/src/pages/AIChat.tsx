import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Bot, Brain, FileSearch, LoaderCircle, LogOut, ScanText, Send, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { saveAutofillSnapshot } from '../lib/aiAutofill';
import { apiBaseUrl } from '../lib/auth';
import { getStudyTypeInfo } from '../lib/studyTypes';


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
  provider?: string;
  responseLanguage?: 'arabic' | 'english' | string;
  error?: string;
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

type DocumentTextResult = {
  documentReady: boolean;
  message: string;
  text: string;
  format: string;
  metadata?: Record<string, unknown>;
};

const isAssistantResult = (value: unknown): value is AssistantResult =>
  value !== null && typeof value === 'object' && 'answer' in value;

const hasGroundedKnowledgeResult = (result: KnowledgeQueryResult) => result.citations.length > 0;

const getTextDirection = (text: string): 'rtl' | 'ltr' => {
  const arabicCount = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabicCount > 0 && arabicCount >= Math.max(3, latinCount * 0.25) ? 'rtl' : 'ltr';
};

const stripFence = (text: string) =>
  text
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const isTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const parseTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-950">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

function FormattedResponse({ text }: { text: string }) {
  const cleanText = stripFence(text);
  const direction = getTextDirection(cleanText);
  const lines = cleanText.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  const isSpecialLine = (line: string, nextLine?: string) => {
    const trimmed = line.trim();
    return (
      !trimmed ||
      /^#{1,4}\s+/.test(trimmed) ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+[.)]\s+/.test(trimmed) ||
      /^-{3,}$/.test(trimmed) ||
      (trimmed.includes('|') && Boolean(nextLine && isTableSeparator(nextLine)))
    );
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = level <= 2 ? 'text-lg font-bold text-slate-950' : 'text-base font-bold text-slate-900';
      blocks.push(
        <h3 key={`heading-${index}`} className={className}>
          {renderInlineMarkdown(heading[2], `heading-${index}`)}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`rule-${index}`} className="border-slate-200" />);
      index += 1;
      continue;
    }

    if (trimmed.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = parseTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={`${header}-${headerIndex}`} className="px-3 py-2 font-semibold text-slate-900">
                    {renderInlineMarkdown(header, `table-header-${index}-${headerIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, rowIndex) => (
                <tr key={`row-${index}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-slate-700">
                      {renderInlineMarkdown(cell, `table-cell-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className={`space-y-2 ${direction === 'rtl' ? 'list-disc pr-5' : 'list-disc pl-5'}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className={`space-y-2 ${direction === 'rtl' ? 'list-decimal pr-5' : 'list-decimal pl-5'}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isSpecialLine(lines[index], lines[index + 1])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(paragraphLines.join(' '), `paragraph-${index}`)}
      </p>,
    );
  }

  return (
    <div
      dir={direction}
      className={`rounded-xl border border-slate-200 bg-white p-5 text-[15px] leading-7 text-slate-800 shadow-sm ${
        direction === 'rtl' ? 'text-right' : 'text-left'
      }`}
    >
      <div className="space-y-4">{blocks}</div>
    </div>
  );
}

const sampleSizeTestTypes = [
  'independent_t_test',
  'paired_t_test',
  'two_proportion_z_test',
  'anova',
  'repeated_measures_anova',
] as const;

type SampleSizeAutofillDraft = {
  testType?: (typeof sampleSizeTestTypes)[number];
  effectSize?: string;
  alpha?: string;
  power?: string;
  ratio?: string;
  dropoutRate?: string;
  alternative?: 'two-sided' | 'larger' | 'smaller';
  approved?: boolean;
};

const normalizeDecimalString = (value?: string | null) => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(',', '.').trim());
  return Number.isFinite(parsed) ? String(parsed) : undefined;
};

const normalizePercentLike = (value?: string | null) => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed > 1 ? String(parsed / 100) : String(parsed);
};

const firstMatch = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
};

const extractSampleSizeDraftFromText = (text: string): SampleSizeAutofillDraft => {
  const normalized = text.replace(/\s+/g, ' ');
  const draft: SampleSizeAutofillDraft = {};

  if (/repeated\s+measures|within[-\s]?subject|longitudinal|متكررة/i.test(normalized)) {
    draft.testType = 'repeated_measures_anova';
  } else if (/paired|matched|before\s+and\s+after|pre[-\s]?post|زوج/i.test(normalized)) {
    draft.testType = 'paired_t_test';
  } else if (/anova|three\s+groups|3\s+groups|more\s+than\s+two\s+groups|أكثر من مجموعتين/i.test(normalized)) {
    draft.testType = 'anova';
  } else if (/proportion|prevalence|percentage|rate|نسبة|انتشار/i.test(normalized)) {
    draft.testType = 'two_proportion_z_test';
  } else if (/rct|random|two\s+groups|intervention|control|تجربة|عشو/i.test(normalized)) {
    draft.testType = 'independent_t_test';
  }

  draft.effectSize = normalizeDecimalString(firstMatch(normalized, [
    /(?:effect\s*size|cohen'?s?\s*d|hedges'?s?\s*g|حجم\s*الأثر)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /\bd\s*=\s*(\d+(?:[.,]\d+)?)/i,
    /\bg\s*=\s*(\d+(?:[.,]\d+)?)/i,
  ]));
  draft.alpha = normalizePercentLike(firstMatch(normalized, [
    /(?:alpha|significance\s*level|مستوى\s*الدلالة|α)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?/i,
    /\bp\s*<\s*(0?\.\d+)/i,
  ]));
  draft.power = normalizePercentLike(firstMatch(normalized, [
    /(?:power|statistical\s*power|قوة\s*إحصائية|القوة)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?/i,
    /\b(80|85|90|95)\s*%\s*(?:power|statistical\s*power|قوة)/i,
  ]));
  draft.dropoutRate = normalizePercentLike(firstMatch(normalized, [
    /(?:dropout|attrition|loss\s*to\s*follow[-\s]?up|انسحاب|فقدان\s*المتابعة)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?/i,
    /(\d+(?:[.,]\d+)?)\s*%\s*(?:dropout|attrition|loss\s*to\s*follow[-\s]?up|انسحاب)/i,
  ]));

  const ratioMatch = normalized.match(/(?:allocation\s*ratio|ratio|نسبة\s*التوزيع)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)/i);
  if (ratioMatch) {
    const first = Number(ratioMatch[1].replace(',', '.'));
    const second = Number(ratioMatch[2].replace(',', '.'));
    if (Number.isFinite(first) && Number.isFinite(second) && first > 0) {
      draft.ratio = String(second / first);
    }
  }

  if (/one[-\s]?sided|اتجاه\s+واحد/i.test(normalized)) {
    draft.alternative = 'larger';
  } else if (/two[-\s]?sided|two[-\s]?tailed|اتجاهين|ثنائي/i.test(normalized)) {
    draft.alternative = 'two-sided';
  }

  draft.approved = Boolean(draft.effectSize && draft.alpha && draft.power);

  return draft;
};

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
  const normalized = text.replace(/\s+/g, ' ');
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

  const ageFallback = normalized.match(/(?:patient\s*)?(?:age|العمر|سن)\s*[:=-]?\s*(\d{1,3})(?:\s*(?:years?|yrs?|سنة|عام))?/i);
  const pocketFallback = normalized.match(/(?:ppd|pocket\s*depth|probing\s*depth|عمق\s*الجيب)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)/i);
  const bpFallback = normalized.match(/(?:bp|blood\s*pressure|ضغط\s*الدم)\s*[:=-]?\s*(\d{2,3})\s*\/\s*(\d{2,3})/i);
  const systolicFallback = normalized.match(/(?:systolic|sbp|الانقباضي)\s*[:=-]?\s*(\d{2,3})/i);
  const diastolicFallback = normalized.match(/(?:diastolic|dbp|الانبساطي)\s*[:=-]?\s*(\d{2,3})/i);
  const heartFallback = normalized.match(/(?:heart\s*rate|pulse|معدل\s*القلب|النبض)\s*[:=-]?\s*(\d{2,3})/i);
  const smokingFallback = normalized.match(/(?:smoking\s*status|smoker|smoking|التدخين|مدخن)\s*[:=-]?\s*(yes|no|نعم|لا)/i);

  if (!draft.patientAge && ageFallback) {
    draft.patientAge = ageFallback[1];
  }
  if (!draft.pocketDepthMm && pocketFallback) {
    draft.pocketDepthMm = pocketFallback[1].replace(',', '.');
  }
  if ((!draft.systolicBpMmhg || !draft.diastolicBpMmhg) && bpFallback) {
    draft.systolicBpMmhg = bpFallback[1];
    draft.diastolicBpMmhg = bpFallback[2];
  }
  if (!draft.systolicBpMmhg && systolicFallback) {
    draft.systolicBpMmhg = systolicFallback[1];
  }
  if (!draft.diastolicBpMmhg && diastolicFallback) {
    draft.diastolicBpMmhg = diastolicFallback[1];
  }
  if (!draft.heartRateBpm && heartFallback) {
    draft.heartRateBpm = heartFallback[1];
  }
  if (!draft.smokingStatus && smokingFallback) {
    const smoking = smokingFallback[1].toLowerCase();
    draft.smokingStatus = smoking === 'yes' || smoking === 'نعم' ? 'yes' : 'no';
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
const datasetFileAccept = '.csv,.xlsx,.xls,.sav';
const documentFileAccept = '.pdf';
const imageFileAccept = '.png,.jpg,.jpeg,.webp,.gif';
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
  const [autofillNotice, setAutofillNotice] = useState('');
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState(searchParams.get('studyId') ?? '');
  const [persistedFiles, setPersistedFiles] = useState<PersistedStudyFile[]>([]);
  const [persistedAnalyses, setPersistedAnalyses] = useState<PersistedStudyAnalysis[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const datasetInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const acceptedFileLabel = useMemo(() => {
    if (selectedFile) {
      return selectedFile.name;
    }

    return t('aiChat.noFileSelected');
  }, [selectedFile, t]);

  const availableColumns = datasetProfile?.profile.columnNames ?? [];
  const selectedStudy = studies.find((study) => study.id === selectedStudyId) ?? null;
  const knowledgeEngineAvailable = Boolean(knowledgeHealth || health);

  const setSelectedFileAndFocus = (file: File | null, source: 'dataset' | 'document' | 'image') => {
    setSelectedFile(file);
    if (!file) {
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isPdf = extension === 'pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension);
    const isDataset = ['csv', 'xlsx', 'xls', 'sav'].includes(extension);

    if (source === 'dataset' && !isDataset) {
      setError('اختر ملف بيانات بصيغة CSV أو XLSX أو XLS أو SAV.');
      return;
    }
    if (source === 'document' && !isPdf) {
      setError('اختر ملف PDF فقط لهذا المسار.');
      return;
    }
    if (source === 'image' && !isImage) {
      setError('اختر صورة بصيغة PNG أو JPG أو JPEG أو WEBP أو GIF.');
      return;
    }
    setError('');
  };

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
          response_language: getTextDirection(prompt) === 'rtl' ? 'arabic' : 'english',
          study_type: selectedStudy?.studyType,
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

  const handleSmartKnowledgeAutofill = async () => {
    if (!authHeaders) {
      return;
    }

    if (!selectedFile && !prompt.trim()) {
      setError('ارفع مقترح البحث أو اكتب نص البروتوكول أولا حتى يستطيع AI تعبئة الحقول.');
      return;
    }

    try {
      setError('');
      setAutofillNotice('');
      setIsBusy(true);

      let sourceText = prompt.trim();
      let sourceLabel = selectedStudy?.title || 'Prompt';
      let ingestedEffectSize: number | undefined;
      let ingestedStudyGroups: string[] | undefined;

      if (selectedFile) {
        sourceLabel = selectedFile.name;

        const textFormData = new FormData();
        textFormData.append('file', selectedFile);
        const textResponse = await fetch(`${apiBaseUrl}/analytics/document/extract-text`, {
          method: 'POST',
          headers: authHeaders,
          body: textFormData,
        });

        if (textResponse.ok) {
          const documentText = (await textResponse.json()) as DocumentTextResult;
          if (documentText.text.trim()) {
            sourceText = documentText.text.trim();
            if (!prompt.trim()) {
              setPrompt(sourceText.slice(0, 1600));
            }
          }
        }

        const ingestFormData = new FormData();
        ingestFormData.append('file', selectedFile);
        ingestFormData.append('document_type', knowledgeDocumentType);
        const ingestResponse = await fetch(`${apiBaseUrl}/analytics/knowledge/ingest`, {
          method: 'POST',
          headers: authHeaders,
          body: ingestFormData,
        });

        if (ingestResponse.ok) {
          const ingestData = (await ingestResponse.json()) as KnowledgeIngestResult;
          setKnowledgeIngestResult(ingestData);
          setKnowledgeFilterSource(ingestData.filename);
          ingestedEffectSize = ingestData.extracted_effect_size ?? undefined;
          ingestedStudyGroups = ingestData.study_groups ?? undefined;
        }
      }

      if (!sourceText.trim()) {
        setError('لم أستطع استخراج نص من الملف. جرّب PDF نصي أو صورة أوضح أو الصق نص البروتوكول في السؤال.');
        return;
      }

      const sampleDraft = extractSampleSizeDraftFromText(sourceText);
      if (!sampleDraft.effectSize && typeof ingestedEffectSize === 'number') {
        sampleDraft.effectSize = String(ingestedEffectSize);
      }
      if (!sampleDraft.alpha) {
        sampleDraft.alpha = sampleSizeAlpha || '0.05';
      }
      if (!sampleDraft.power) {
        sampleDraft.power = sampleSizePower || '0.8';
      }
      if (!sampleDraft.ratio) {
        sampleDraft.ratio = sampleSizeRatio || '1';
      }
      if (!sampleDraft.dropoutRate) {
        sampleDraft.dropoutRate = sampleSizeDropoutRate || '0.15';
      }
      if (!sampleDraft.alternative) {
        sampleDraft.alternative = sampleSizeAlternative;
      }
      sampleDraft.approved = Boolean(sampleDraft.effectSize && sampleDraft.alpha && sampleDraft.power);

      if (sampleDraft.testType) {
        setSampleSizeTestType(sampleDraft.testType);
      }
      if (sampleDraft.effectSize) {
        setSampleSizeEffectSize(sampleDraft.effectSize);
      }
      if (sampleDraft.alpha) {
        setSampleSizeAlpha(sampleDraft.alpha);
      }
      if (sampleDraft.power) {
        setSampleSizePower(sampleDraft.power);
      }
      if (sampleDraft.ratio) {
        setSampleSizeRatio(sampleDraft.ratio);
      }
      if (sampleDraft.dropoutRate) {
        setSampleSizeDropoutRate(sampleDraft.dropoutRate);
      }
      if (sampleDraft.alternative) {
        setSampleSizeAlternative(sampleDraft.alternative);
      }
      setSampleSizeApproved(sampleDraft.approved);
      if (!knowledgeLimit.trim()) {
        setKnowledgeLimit('5');
      }
      if (knowledgeDocumentType === 'research_proposal') {
        setMode('study_elements');
      }

      const extractedClinicalDraft = extractClinicalDraftFromText(sourceText);
      const nextClinicalDraft: ClinicalDraft = {
        ...clinicalDraft,
        ...extractedClinicalDraft,
      };
      setClinicalDraft(nextClinicalDraft);

      mergeAutofillSnapshot({
        studyGroups: ingestedStudyGroups,
        suggestedEffectSize: sampleDraft.effectSize ? Number(sampleDraft.effectSize) : ingestedEffectSize,
        suggestedPrompt: sourceText.slice(0, 1200),
        sourceLabel,
        clinicalDraft: extractedClinicalDraft,
      });

      const actions: string[] = [];
      if (sampleDraft.effectSize) {
        await handleSampleSizeCalculation(sampleDraft, false);
        actions.push('تم حساب حجم العينة');
      } else {
        actions.push('لم يتم العثور على effect size واضح');
      }

      if (nextClinicalDraft.patientAge && nextClinicalDraft.pocketDepthMm) {
        await handleClinicalValidation(nextClinicalDraft, false);
        actions.push('تم التحقق السريري');
      } else {
        actions.push('الحقول السريرية تحتاج بيانات مريض أو OCR أوضح');
      }

      setAutofillNotice(`تمت التعبئة الذكية من ${sourceLabel}. ${actions.join('، ')}.`);
    } catch {
      setError('تعذر تنفيذ التعبئة الذكية. تأكد من الملف أو الصق نص المقترح ثم أعد المحاولة.');
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

  const handleSampleSizeCalculation = async (draft: SampleSizeAutofillDraft = {}, manageBusy = true) => {
    if (!authHeaders) {
      return;
    }

    try {
      setError('');
      if (manageBusy) {
        setIsBusy(true);
      }
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/sample-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          test_type: draft.testType ?? sampleSizeTestType,
          effect_size: toOptionalNumber(draft.effectSize ?? sampleSizeEffectSize),
          alpha: Number((draft.alpha ?? sampleSizeAlpha) || 0.05),
          power: Number((draft.power ?? sampleSizePower) || 0.8),
          ratio: Number((draft.ratio ?? sampleSizeRatio) || 1),
          alternative: draft.alternative ?? sampleSizeAlternative,
          approved: draft.approved ?? sampleSizeApproved,
          dropout_rate: Number((draft.dropoutRate ?? sampleSizeDropoutRate) || 0.15),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to calculate sample size');
      }

      const data = (await response.json()) as KnowledgeSampleSizeResult;
      setSampleSizeResult(data);
      if (!sampleSizeEffectSize && !draft.effectSize && typeof data.proposed_effect_size === 'number') {
        setSampleSizeEffectSize(String(data.proposed_effect_size));
      }
    } catch {
      setError('تعذر تنفيذ حساب حجم العينة عبر المكتبة المعرفية.');
    } finally {
      if (manageBusy) {
        setIsBusy(false);
      }
    }
  };

  const handleClinicalValidation = async (draft: ClinicalDraft = clinicalDraft, manageBusy = true) => {
    if (!authHeaders) {
      return;
    }

    const patientAge = toOptionalNumber(draft.patientAge);
    const pocketDepthMm = toOptionalNumber(draft.pocketDepthMm);
    if (patientAge === undefined || pocketDepthMm === undefined) {
      setError('أدخل العمر وعمق الجيب أو استخرجهما من OCR قبل التحقق السريري.');
      return;
    }

    try {
      setError('');
      if (manageBusy) {
        setIsBusy(true);
      }
      const response = await fetch(`${apiBaseUrl}/analytics/knowledge/validate-clinical`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          patient_age: patientAge,
          pocket_depth_mm: pocketDepthMm,
          systolic_bp_mmhg: toOptionalNumber(draft.systolicBpMmhg),
          diastolic_bp_mmhg: toOptionalNumber(draft.diastolicBpMmhg),
          heart_rate_bpm: toOptionalNumber(draft.heartRateBpm),
          smoking_status: draft.smokingStatus,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to validate clinical parameters');
      }

      setClinicalValidation((await response.json()) as ClinicalValidationResult);
    } catch {
      setError('تعذر تنفيذ التحقق السريري من البيانات المستخرجة.');
    } finally {
      if (manageBusy) {
        setIsBusy(false);
      }
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
      value: knowledgeEngineAvailable ? 'Connected' : 'Unavailable',
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
        <>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <Printer className="h-4 w-4" />
            طباعة كـ PDF
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            {t('dashboard.common.logout')}
          </button>
        </>
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
            <div className="grid min-w-[300px] gap-3">
              {selectedStudy ? (
                <div className="rounded-2xl bg-white/10 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-teal-400"></span>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-teal-200">
                      مكتبة معرفية مربوطة: {getStudyTypeInfo(selectedStudy.studyType).shortLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-black text-white">
                    {getStudyTypeInfo(selectedStudy.studyType).labelAr}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-300">
                    {getStudyTypeInfo(selectedStudy.studyType).primaryGuideline}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-100">
                  تحليل خارجي حر (غير مرتبط بدراسة)
                </div>
              )}
              {user ? (
                <div className="rounded-2xl bg-white/10 px-4 py-2.5 text-xs font-extrabold text-slate-200">
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
                    <div className="flex flex-wrap gap-3">
                      <input ref={datasetInputRef} type="file" accept={datasetFileAccept} onChange={(event) => setSelectedFileAndFocus(event.target.files?.[0] ?? null, 'dataset')} className="hidden" />
                      <input ref={pdfInputRef} type="file" accept={documentFileAccept} onChange={(event) => setSelectedFileAndFocus(event.target.files?.[0] ?? null, 'document')} className="hidden" />
                      <input ref={imageInputRef} type="file" accept={imageFileAccept} onChange={(event) => setSelectedFileAndFocus(event.target.files?.[0] ?? null, 'image')} className="hidden" />
                      <button type="button" onClick={() => datasetInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        ملف بيانات
                      </button>
                      <button type="button" onClick={() => pdfInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        ملف PDF
                      </button>
                      <button type="button" onClick={() => imageInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        صورة
                      </button>
                      <button type="button" onClick={() => cameraInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        التقاط صورة من الهاتف
                      </button>
                    </div>
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => setSelectedFileAndFocus(event.target.files?.[0] ?? null, 'image')} className="hidden" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">{acceptedFileLabel}</p>
                    <p className="mt-1 text-xs text-slate-500">CSV / XLSX / SAV / PDF / PNG / JPG / JPEG / WEBP / GIF</p>
                    <div className="mt-4 flex flex-wrap gap-3">
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
                <div className={`prototype-chip ${knowledgeEngineAvailable ? 'active' : ''}`}>{knowledgeEngineAvailable ? 'Connected' : 'Offline'}</div>
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
                <button type="button" onClick={() => void handleSmartKnowledgeAutofill()} className="rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white hover:bg-teal-700">AI تعبئة ذكية كاملة</button>
                <button type="button" onClick={() => void handleSampleSizeCalculation()} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700">حساب حجم العينة</button>
                <button type="button" onClick={() => void handleClinicalValidation()} className="rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 text-sm font-medium text-purple-700 hover:bg-purple-100">تحقق سريري من الحقول</button>
              </div>
              {autofillNotice ? (
                <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800">
                  {autofillNotice}
                </div>
              ) : null}
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
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">{t('aiChat.results.assistant')}</h2>
                      <p className="text-sm text-slate-500">
                        {assistantResult.usedLLM ? assistantResult.model : t('aiChat.results.fallbackAssistant')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className={`rounded-full px-3 py-1 ${
                      assistantResult.usedLLM
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
                    }`}>
                      {assistantResult.usedLLM ? 'Live AI' : 'Fallback'}
                    </span>
                    {assistantResult.provider ? (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 ring-1 ring-blue-100">
                        {assistantResult.provider}
                      </span>
                    ) : null}
                    {assistantResult.responseLanguage ? (
                      <span className="rounded-full bg-slate-50 px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                        {assistantResult.responseLanguage === 'arabic' ? 'العربية' : 'English'}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4">
                  <FormattedResponse text={assistantResult.answer} />
                </div>
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
                    <div className="mt-4">
                      <FormattedResponse text={knowledgeResult.answer} />
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
                            <p className="mt-1 text-xs">
                              {attempt.useful ? 'Cited evidence found' : 'No citable evidence returned'}
                            </p>
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
