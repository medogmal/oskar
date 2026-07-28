import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calculator,
  ChevronRight,
  MessageSquareCode,
  Target,
  Workflow,
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldCheck,
  BarChart3,
  PieChart,
  Zap,
  Sparkles,
  Brain,
  ShieldAlert,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { SeverityBadge, ScaleBadge } from '../components/SeverityBadges';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';
import type { MeasurementScale, MissingDataPattern } from '../types/clinresearch';
import { SCALE_STYLES } from '../lib/severityHelpers';
import {
  LineChart as ReLine,
  Line as ReLine2,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
  PieChart as RePie,
  Pie,
} from 'recharts';

type TabKey = 'sample-size' | 'stat-tree' | 'missing-data';

type SampleSizeForm = {
  testType: 't_test' | 'paired_t' | 'proportion' | 'anova' | 'rm_anova' | 'non_inferior' | 'survival' | 'cluster';
  alpha: number;
  power: number;
  effectSize: number;
  effectSizeType: string;
  effectSizeSource: string;
  marginNI: number;
  dropout: number;
  groups: number;
  ratio: number;
  studyType: string;
  outcomeType: string;
  icc: number;
  clusterSize: number;
  alternative: 'two_sided' | 'one_sided';
  assumptionSources: { alpha: string; power: string; ratio: string; icc: string };
};

type TreeNodeState = {
  nodeId: string;
  answerValue: string | number | boolean | null;
};

type TreeOption = {
  label: string;
  value: string | number | boolean;
  next: string;
};

type TreeResult = {
  name: string;
  just: string;
  refs: string[];
  alts: Array<{ name: string; why: string }>;
  assumptions: string[];
};

type TreeDefinition = {
  q?: string;
  options?: TreeOption[];
  result?: TreeResult;
};

type MissingDataApiResult = {
  summary: {
    rows: number;
    columns: number;
    totalMissingCells: number;
    overallMissingPercentage: number;
    mcarColumns: number;
    marColumns: number;
    mnarColumns: number;
  };
  columnsAnalysis: Array<
    MissingDataColumn
  >;
};

type MissingDataColumn = MissingDataPattern & {
  justification?: string;
  sensitivityAnalysis?: string;
  topCorrelationWithMissingness?: number;
};

const DEFAULT_SS: SampleSizeForm = {
  testType: 't_test',
  alpha: 0.05,
  power: 0.8,
  effectSize: 0.5,
  effectSizeType: "Cohen's d",
  effectSizeSource: 'ICH E9 default (medium effect)',
  marginNI: 0.1,
  dropout: 0.15,
  groups: 2,
  ratio: 1,
  studyType: 'rct',
  outcomeType: 'continuous',
  icc: 0.05,
  clusterSize: 20,
  alternative: 'two_sided',
  assumptionSources: { alpha: 'ICH E9 Section 2.3.3', power: 'Conventional 80% (Cohen 1988)', ratio: '1:1 design, equally sized groups', icc: 'Campbell & Walters 2014, typical dentistry ICC' },
};

export default function AnalyticsWorkspace() {
  const navigate = useNavigate();
  const { id: studyId = 'demo' } = useParams();
  const [tab, setTab] = useState<TabKey>('sample-size');

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav(studyId)}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate('/studies/' + studyId)} className="inline-flex items-center gap-1 rounded-md text-sm text-slate-400 hover:text-slate-200">
              <ArrowLeft className="h-4 w-4" /> Back to study
            </button>
            <Brain className="h-5 w-5 text-fuchsia-400" />
            <h1 className="text-lg font-semibold">Analytics Workspace — Statistical &amp; Study Size</h1>
          </div>
          <div className="inline-flex rounded-lg border border-slate-800 p-1 bg-slate-900/60">
            <TabBtn active={tab === 'sample-size'} onClick={() => setTab('sample-size')}>
              <Calculator className="h-3.5 w-3.5" /> Sample Size
            </TabBtn>
            <TabBtn active={tab === 'stat-tree'} onClick={() => setTab('stat-tree')}>
              <Workflow className="h-3.5 w-3.5" /> Test Decision Tree
            </TabBtn>
            <TabBtn active={tab === 'missing-data'} onClick={() => setTab('missing-data')}>
              <ShieldAlert className="h-3.5 w-3.5" /> Missing Data
            </TabBtn>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">
          {tab === 'sample-size' && <SampleSizeTab />}
          {tab === 'stat-tree' && <StatTestTree />}
          {tab === 'missing-data' && <MissingDataTab />}
        </div>
      </div>
    </ResearchWorkspaceShell>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
      }`}
    >
      {children}
    </button>
  );
}

/* =============================================================== */
/* ========================= SAMPLE SIZE TAB ==================== */
/* =============================================================== */

function zTwoTailed(alpha: number) {
  const norm: Record<string, number> = { 0.01: 2.576, 0.02: 2.326, 0.05: 1.96, 0.1: 1.645, 0.2: 1.282, 0.5: 0.674 };
  for (const k of Object.keys(norm)) if (Math.abs(Number(k) - alpha) < 0.0001) return norm[k];
  return 1.96;
}
function zOneTailed(alpha: number) {
  const norm: Record<string, number> = { 0.005: 2.576, 0.01: 2.326, 0.025: 1.96, 0.05: 1.645, 0.1: 1.282 };
  for (const k of Object.keys(norm)) if (Math.abs(Number(k) - alpha) < 0.0001) return norm[k];
  return 1.645;
}
function betaFromPower(power: number) { return 1 - power; }

function computeSampleSize(form: SampleSizeForm) {
  const za = form.alternative === 'two_sided' ? zTwoTailed(form.alpha) : zOneTailed(form.alpha);
  const zb = zOneTailed(betaFromPower(form.power));
  let nPerGroup = 0;
  let formulaLatex = '';
  let why = '';

  switch (form.testType) {
    case 't_test': {
      const r = form.ratio;
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) * (1 / form.effectSize / form.effectSize) * (r + 1) / r);
      formulaLatex = 'n = (Zα/2 + Zβ)² · (1+1/r) / δ²';
      why = 'The study compares ' + form.groups + ' independent groups on a CONTINUOUS outcome → two-sample t-test is appropriate. Formula per Chow, Shao, Wang (2008) Sample Size Calculations in Clinical Research.';
      break;
    }
    case 'paired_t': {
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) / (form.effectSize * form.effectSize));
      formulaLatex = 'n = (Zα/2 + Zβ)² / δ²  (paired, within-subject)';
      why = 'Paired/repeated measurements on the same subjects (repeated t-test / within-subject) — reduces variance, therefore smaller sample.';
      break;
    }
    case 'proportion': {
      const p1 = form.effectSize;
      const p2 = Math.min(Math.max(p1 + form.marginNI, 0.001), 0.999);
      const r = form.ratio;
      const pbar = (p1 + r * p2) / (1 + r);
      nPerGroup = Math.ceil(
        (Math.pow(za + zb, 2) * (pbar * (1 - pbar)) * (1 + 1 / r)) / Math.pow(p2 - p1, 2)
      );
      formulaLatex = 'n = (Zα/2 + Zβ)² · (p̄(1-p̄)·(1+1/r)) / (p1-p2)²';
      why = 'Binary / proportional outcome comparison between two groups. Uses Normal approximation (Arc-Sine variance-stabilizing may be considered, but this is the standard textbook formula per Altman 1991).';
      break;
    }
    case 'anova': {
      const k = Math.max(2, form.groups);
      const lambda = k * form.effectSize * form.effectSize / 2;
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) * k / (2 * lambda));
      formulaLatex = 'n per group ≈ (Zα/2 + Zβ)² · k / (2 · λ),  λ = k·δ²/2';
      why = 'One-way ANOVA across ' + k + ' independent groups. Formula approximates non-central F-distribution (Cohen 1988, Statistical Power Analysis for the Behavioral Sciences).';
      break;
    }
    case 'rm_anova': {
      const rho = 0.4; // assumed sphericity correlation
      const k = Math.max(2, form.groups);
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) / (form.effectSize * form.effectSize) * (1 - rho) * k);
      formulaLatex = 'n = (Zα/2+Zβ)² · (1-ρ)·k / δ²';
      why = 'Repeated-measures across ' + k + ' time points / treatments within subject. Assumes compound symmetry, ρ=' + rho + '.';
      break;
    }
    case 'non_inferior': {
      const margin = Math.abs(form.marginNI);
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) * 2 * 0.25 / Math.pow(margin, 2));
      formulaLatex = 'n = (Zα + Zβ)² · 2·σ² / ΔNI²   (ΔNI = NI margin)';
      why = 'Non-Inferiority design with Δ = ' + margin + ' margin. Formula per ICH E10 guidance and Piaggio et al. 2006.';
      break;
    }
    case 'survival': {
      const hr = Math.exp(-form.effectSize); // hazard ratio
      const p1 = 0.5;
      const p2 = p1 * hr / (1 - p1 + p1 * hr);
      nPerGroup = Math.ceil(Math.pow(za + zb, 2) * (1 + 1 / form.ratio) / (form.ratio * Math.pow(Math.log(hr), 2) * p1 * (1 - p1) + 1 / (form.ratio * p2 * (1 - p2))));
      formulaLatex = 'Events E = (Zα + Zβ)² · (1+1/r)² / (r·p1·(1-p1) + p2·(1-p2)/r)';
      why = 'Survival / Time-to-Event with proportional hazards assumption. Per Schoenfeld 1981 (log-rank formula). HR assumed: ' + hr.toFixed(3) + '.';
      break;
    }
    case 'cluster': {
      const k = form.clusterSize;
      const icc = form.icc;
      const base = Math.pow(za + zb, 2) * (1 + 1 / form.ratio) / (form.effectSize * form.effectSize);
      const designEffect = 1 + (k - 1) * icc;
      nPerGroup = Math.ceil(base * designEffect);
      formulaLatex = 'n = n_individual · DEFF,   DEFF = 1 + (k-1) · ICC';
      why = 'Cluster-RCT, cluster size=' + k + ', ICC=' + icc + ', DEFF=' + designEffect.toFixed(3) + '. Per CONSORT 2010 Extension to Cluster Trials.';
      break;
    }
  }

  const adjustedN = Math.ceil(nPerGroup / (1 - form.dropout));
  const finalTotal = adjustedN * Math.max(2, Math.ceil((form.ratio + 1)));

  const scenarios = [-0.2, -0.1, 0, 0.1, 0.2].map(delta => {
    const es = Math.max(0.05, form.effectSize + delta);
    const zaS = form.alternative === 'two_sided' ? zTwoTailed(form.alpha) : zOneTailed(form.alpha);
    const zbS = zOneTailed(betaFromPower(form.power));
    let nS = Math.ceil(Math.pow(zaS + zbS, 2) * (1 + 1 / form.ratio) / (form.ratio * es * es));
    const nSAdj = Math.ceil(nS / (1 - form.dropout));
    return { label: 'ES=' + es.toFixed(2), scenario: 'Effect ' + (delta > 0 ? '+' : '') + (delta * 100).toFixed(0) + '%', sampleSize: nSAdj };
  });

  return { nPerGroup, adjustedN, finalTotal, formulaLatex, why, scenarios, za, zb };
}

function SampleSizeTab() {
  const [form, setForm] = useState<SampleSizeForm>(DEFAULT_SS);
  const result = useMemo(() => computeSampleSize(form), [form]);

  const update = <K extends keyof SampleSizeForm>(key: K, val: SampleSizeForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.1fr)]">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Calculator className="h-4 w-4 text-indigo-300" /> Sample Size &amp; Power Parameters</h2>
        <p className="text-xs text-slate-400 mt-1">Every input field can track the source of its assumption. All inputs below automatically update the result and sensitivity plot on the right.</p>
        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <FieldBox label="Statistical Test / Design" sub="Determines which formula is applied">
              <select value={form.testType} onChange={e => update('testType', e.target.value as any)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100">
                <option value="t_test">Two-sample t-test (2 independent groups)</option>
                <option value="paired_t">Paired / Repeated t-test (within subject)</option>
                <option value="proportion">Two-proportion z-test (binary outcome)</option>
                <option value="anova">One-way ANOVA (≥2 groups)</option>
                <option value="rm_anova">Repeated Measures ANOVA</option>
                <option value="non_inferior">Non-Inferiority (continuous outcome)</option>
                <option value="survival">Survival / Cox / Log-Rank (Time-to-Event)</option>
                <option value="cluster">Cluster-RCT (with ICC correction)</option>
              </select>
            </FieldBox>
            <FieldBox label="Outcome Type" sub="Auto-suggested based on test">
              <select value={form.outcomeType} onChange={e => update('outcomeType', e.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100">
                <option value="continuous">Continuous (e.g., PD mm, VAS)</option>
                <option value="binary">Binary (e.g., BoP Yes/No)</option>
                <option value="ordinal">Ordinal (e.g., Success scale)</option>
                <option value="count">Count (e.g., Number of caries)</option>
                <option value="tte">Time-to-event / Survival</option>
              </select>
            </FieldBox>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <NumericField label="α (Alpha)" value={form.alpha} onChange={v => update('alpha', v)} step={0.005} min={0.001} max={0.5} help="Type I error" />
            <NumericField label="Power (1−β)" value={form.power} onChange={v => update('power', v)} step={0.05} min={0.5} max={0.99} help="Typical 0.8 or 0.9" />
            <NumericField label="Effect Size" value={form.effectSize} onChange={v => update('effectSize', v)} step={0.05} min={0.01} max={10} />
            <NumericField label="Dropout %" value={form.dropout * 100} onChange={v => update('dropout', v / 100)} step={1} min={0} max={70} help="Attrition adjustment" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldBox label="Effect Size Type" sub="Classify the metric">
              <select value={form.effectSizeType} onChange={e => update('effectSizeType', e.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm">
                <option>Cohen&apos;s d (standardized mean diff.)</option>
                <option>Hedges&apos; g (unbiased)</option>
                <option>Risk Difference RD (%)</option>
                <option>Odds Ratio OR</option>
                <option>Hazard Ratio HR (log scale)</option>
                <option>Cramér&apos;s V</option>
                <option>Eta-squared (η²)</option>
              </select>
            </FieldBox>
            <FieldBox label="Effect Size Source" sub="Where did this number come from?">
              <input value={form.effectSizeSource} onChange={e => update('effectSizeSource', e.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" />
            </FieldBox>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumericField label="Groups (k)" value={form.groups} onChange={v => update('groups', Math.max(2, Math.round(v)))} step={1} min={2} max={20} />
            <NumericField label="Allocation Ratio (Nexp/Nctl)" value={form.ratio} onChange={v => update('ratio', v)} step={0.1} min={0.25} max={5} />
            <FieldBox label="Alternative Hypothesis">
              <select value={form.alternative} onChange={e => update('alternative', e.target.value as any)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm">
                <option value="two_sided">Two-sided</option>
                <option value="one_sided">One-sided</option>
              </select>
            </FieldBox>
          </div>

          {(form.testType === 'cluster' || form.testType === 'non_inferior') && (
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              {form.testType === 'cluster' && (
                <>
                  <NumericField label="ICC (ρ)" value={form.icc} onChange={v => update('icc', v)} step={0.005} min={0} max={1} />
                  <NumericField label="Avg Cluster Size k" value={form.clusterSize} onChange={v => update('clusterSize', Math.round(v))} step={1} min={2} max={1000} />
                </>
              )}
              {form.testType === 'non_inferior' && (
                <NumericField label="NI Margin Δ" value={form.marginNI} onChange={v => update('marginNI', v)} step={0.005} min={-1} max={1} />
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-800 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Info className="h-3 w-3" /> Assumption Sources (for audit trail)</div>
            <div className="grid gap-2 text-xs">
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center"><span className="text-slate-400">α Source:</span>
                <input value={form.assumptionSources.alpha} onChange={e => update('assumptionSources', { ...form.assumptionSources, alpha: e.target.value })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center"><span className="text-slate-400">Power:</span>
                <input value={form.assumptionSources.power} onChange={e => update('assumptionSources', { ...form.assumptionSources, power: e.target.value })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center"><span className="text-slate-400">Ratio:</span>
                <input value={form.assumptionSources.ratio} onChange={e => update('assumptionSources', { ...form.assumptionSources, ratio: e.target.value })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center"><span className="text-slate-400">ICC/Other:</span>
                <input value={form.assumptionSources.icc} onChange={e => update('assumptionSources', { ...form.assumptionSources, icc: e.target.value })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5">
        <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-slate-900/60 to-slate-900 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-indigo-300" /> Calculation Result</h2>
            <span className="rounded-full bg-indigo-500/15 px-3 py-0.5 text-xs text-indigo-300 ring-1 ring-inset ring-indigo-500/20">Transparent &amp; Traceable</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatMini label="n / Group (raw)" value={result.nPerGroup.toLocaleString()} accent="text-sky-300" />
            <StatMini label="+ Dropout Adj." value={'+' + (form.dropout * 100).toFixed(0) + '%'} accent="text-amber-300" />
            <StatMini label="FINAL n / Group" value={result.adjustedN.toLocaleString()} accent="text-emerald-300" big />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatMini label="Total Final Sample" value={result.finalTotal.toLocaleString()} accent="text-fuchsia-300" />
            <StatMini label="Zα & Zβ" value={`${result.za.toFixed(3)} · ${result.zb.toFixed(3)}`} accent="text-slate-300" />
          </div>
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Formula Used</div>
            <pre className="font-mono text-[13px] text-sky-300 whitespace-pre-wrap">{result.formulaLatex}</pre>
          </div>
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Why this formula was chosen</div>
            <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{result.why}</p>
          </div>
          <div className="mt-3 grid gap-1.5 text-[11px] text-slate-400">
            <div>✓ <span className="text-slate-300">Effect Size Type:</span> {form.effectSizeType} ({form.effectSizeSource})</div>
            <div>✓ <span className="text-slate-300">Assumption sources</span> documented per parameter (see panel)</div>
            <div>✓ <span className="text-slate-300">Dropout adjustment</span> applied: {form.dropout * 100}% attrition</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-base font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-300" /> Sensitivity Analysis — Effect Size vs. Sample Size</h3>
          <p className="text-xs text-slate-400 mb-2">Answers: "What if the true effect is 10% smaller/larger than our assumption?"</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ReLine data={result.scenarios}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="scenario" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <ReTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReLine2 type="monotone" dataKey="sampleSize" stroke="#818cf8" strokeWidth={3} dot={{ fill: '#a5b4fc', r: 4 }} name="Final n/group" />
              </ReLine>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldBox({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
      </div>
      {children}
    </label>
  );
}

function NumericField({ label, value, onChange, step, min, max, help }: {
  label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; help?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {help && <span className="text-[10px] text-slate-500">{help}</span>}
      </div>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
      />
    </label>
  );
}

function StatMini({ label, value, accent, big }: { label: string; value: string; accent: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={big ? 'mt-1 text-2xl font-bold ' + accent : 'mt-1 text-lg font-semibold ' + accent}>{value}</div>
    </div>
  );
}

/* =============================================================== */
/* ======================= STAT TEST TREE ======================= */
/* =============================================================== */

const TREE: Record<string, TreeDefinition> = {
  start: {
    q: 'What is the primary research question type?',
    options: [
      { label: 'Compare groups (difference in means / medians / proportions)', value: 'compare', next: 'outcome' },
      { label: 'Assess relationship / correlation / prediction', value: 'relate', next: 'result-pearson' },
      { label: 'Predictive performance / ROC / Cutoff', value: 'roc', next: 'result-roc' },
      { label: 'Survival / Time to event', value: 'tte', next: 'result-cox' },
    ],
  },
  outcome: {
    q: 'What is the scale / type of the outcome variable?',
    options: [
      { label: 'Continuous (ratio / interval: e.g., PD mm, VAS)', value: 'continuous', next: 'groups' },
      { label: 'Ordinal (ranked categories: e.g., VAS 1-5, Success scale)', value: 'ordinal', next: 'normal2' },
      { label: 'Binary / Categorical (2+ groups: BoP Y/N, Gender)', value: 'cat', next: 'result-chi' },
      { label: 'Count (#events, rate)', value: 'count', next: 'result-poisson' },
    ],
  },
  groups: {
    q: 'How many independent groups are being compared?',
    options: [
      { label: '1 group only (vs. known reference)', value: 1, next: 'result-t' },
      { label: '2 groups', value: 2, next: 'paired' },
      { label: '3+ independent groups (ANOVA scenario)', value: 3, next: 'normal' },
    ],
  },
  paired: {
    q: 'Are the 2 groups independent samples, or paired / matched / repeated?',
    options: [
      { label: 'Independent samples (parallel groups)', value: 'ind', next: 'normal' },
      { label: 'Paired / Matched / Same-subject (pre-post)', value: 'p', next: 'normal2' },
    ],
  },
  normal: {
    q: 'Assumptions check: Is Normality reasonably satisfied (Shapiro-Wilk p ≥ 0.05)? Homogeneity of variance (Levene p ≥ 0.05)?',
    options: [
      { label: '✓ Assumptions satisfied (Parametric OK)', value: true, next: 'groups-yes' },
      { label: '✗ Violations, or non-normal (robust approach preferred)', value: false, next: 'groups-no' },
    ],
  },
  'groups-yes': {
    result: {
      name: `Independent-Samples t-Test / One-Way ANOVA`,
      just: 'Continuous outcome, independent groups, Normality & Homoscedasticity both met. Use two-sample t-test for k=2, one-way ANOVA for k≥3. If omnibus ANOVA significant → Tukey HSD post-hoc pairwise.',
      refs: ['Altman D (1991) Practical Statistics for Medical Research.', 'ICH E9 Section 5.5 Statistical Analysis.'],
      assumptions: ['Independence of observations', 'Approximate normality within groups (Shapiro-Wilk or central limit theorem for n≥30)', 'Homogeneity of variances (Levene test)'],
      alts: [
        { name: 'Welch t-test', why: 'If equal variances fails but normality holds.' },
        { name: 'Mann-Whitney U', why: 'If normality or independence of rank issue.' },
        { name: 'Permutation Test', why: 'Small samples, unusual distribution, or as robustness check.' },
      ],
    },
  },
  'groups-no': {
    result: {
      name: 'Mann-Whitney U (2 groups) or Kruskal-Wallis H (3+ groups)',
      just: 'Non-parametric rank-based alternative when normality fails or distributions are heavily skewed / ordinal.',
      refs: ['Conover WJ (1999) Practical Nonparametric Statistics.', 'Sheskin DJ Handbook of Parametric and Nonparametric Procedures.'],
      assumptions: ['Independence', 'Similar distribution shape between groups (for location inference).'],
      alts: [
        { name: 'Welch t-test', why: 'Robust to unequal variances; performs well with moderate violations.' },
        { name: 'Bootstrap', why: 'Distribution-free CI for the difference of medians.' },
      ],
    },
  },
  normal2: {
    q: 'For paired / ordinal data: Can the differences / ranks be assumed normal, or use rank-based by default?',
    options: [
      { label: 'Differences reasonably normal (Parametric)', value: true, next: 'result-paired' },
      { label: 'Use non-parametric rank-based (safer default for ordinal)', value: false, next: 'result-wilcoxon' },
      { label: '3+ repeated timepoints / within-subject factor (repeated measures)', value: 'rm', next: 'result-rmanova' },
    ],
  },
  'result-t': {
    result: { name: 'One-Sample t-Test (or Wilcoxon Signed-Rank)', just: 'One group against known reference value.', refs: ['Altman 1991'], assumptions: ['Normality of values', 'Independence'], alts: [{ name: 'Wilcoxon SR', why: 'If non-normal.' }] },
  },
  'result-mw': {
    result: { name: 'Mann-Whitney U', just: '2 independent groups — non-parametric.', refs: ['Sheskin 2021'], assumptions: ['Independence'], alts: [{ name: 't-Test', why: 'If normality holds.' }] },
  },
  'result-paired': {
    result: { name: 'Paired Samples t-Test', just: 'Same-subject / matched pairs, difference scores ~ Normal.', refs: ['Altman 1991'], assumptions: ['Differences normal', 'Paired independence across subjects'], alts: [{ name: 'Wilcoxon Signed-Rank', why: 'If difference-normality fails.' }] },
  },
  'result-wilcoxon': {
    result: { name: 'Wilcoxon Signed-Rank Test', just: 'Default for paired ordinal or when difference-normality fails.', refs: ['Conover 1999'], assumptions: ['Paired observations'], alts: [{ name: 'Paired t', why: 'If differences normal and symmetric.' }] },
  },
  'result-anova': {
    result: { name: 'One-Way ANOVA + Tukey HSD', just: '3+ groups; see decision branch parametric.', refs: ['Maxwell & Delaney 2004'], assumptions: ['Normality within', 'Equal variances'], alts: [{ name: 'Welch ANOVA + Games-Howell', why: 'For unequal variances.' }] },
  },
  'result-kruskal': {
    result: { name: 'Kruskal-Wallis + Dunn post-hoc', just: '3+ groups non-parametric.', refs: ['Sheskin 2021'], assumptions: ['Independence'], alts: [{ name: 'ANOVA', why: 'If assumptions hold.' }] },
  },
  'result-rmanova': {
    result: { name: 'Repeated-Measures ANOVA (or Friedman)', just: 'Within-subject ≥ 2 levels; assumption of Sphericity (Mauchly). Use Greenhouse-Geisser correction if violated.', refs: ['Maxwell & Delaney 2004'], assumptions: ['Sphericity', 'Compound Symmetry'], alts: [{ name: 'Friedman ANOVA by Ranks', why: 'Non-parametric for ordinal or strong violations.' }, { name: 'Mixed-effects model (REML)', why: 'Handles missing data & unbalanced timepoints.' }] },
  },
  'result-friedman': {
    result: { name: 'Friedman Test', just: 'Non-parametric RM-ANOVA.', refs: ['Conover 1999'], assumptions: ['Paired blocks'], alts: [{ name: 'RM-ANOVA', why: 'If parametric holds.' }] },
  },
  'result-chi': {
    result: { name: 'Chi-square Test of Independence / Fisher Exact', just: 'Categorical × Categorical association. Use Fisher Exact for expected cell counts < 5. OR / RR + CI for 2×2.', refs: ['Agresti 2002 Categorical Data Analysis'], assumptions: ['Independence of observations', 'No zero cells (Fisher when small E)'], alts: [{ name: 'Barnard / Boschloo', why: 'Exact unconditional, more powerful than Fisher for 2×2.' }, { name: 'Logistic Regression', why: 'Adjust for covariates and confounding.' }] },
  },
  'result-fisher': { result: { name: 'Fisher Exact Test', just: 'Exact test for sparse tables.', refs: ['Agresti 2002'], assumptions: ['Fixed margins optional'], alts: [{ name: 'Chi-square', why: 'If expected ≥ 5.' }] } },
  'result-logistic': { result: { name: 'Binary Logistic Regression', just: 'Binary outcome predicted by ≥1 covariate; OR as effect size.', refs: ['Hosmer & Lemeshow'], assumptions: ['No perfect multicollinearity', 'Linear logit'], alts: [{ name: 'Exact LR', why: 'Small samples.' }] } },
  'result-cox': {
    result: { name: 'Cox Proportional-Hazards Regression + Kaplan-Meier', just: 'Time-to-event / survival analysis. PH assumption tested via Schoenfeld residuals.', refs: ['Therneau & Grambsch 2000'], assumptions: ['Proportional Hazards', 'No informative censoring'], alts: [{ name: 'Cox with robust sandwich SE', why: 'For mild PH violations / clustering.' }, { name: 'Weibull Parametric Model', why: 'If distributional shape known.' }] },
  },
  'result-poisson': { result: { name: 'Poisson / Negative-Binomial Regression', just: 'Count outcomes; NB for over-dispersion.', refs: ['Cameron & Trivedi Count Data Models'], assumptions: ['Correct link (log)', 'No zero-inflation (otherwise ZIP/ZINB)'], alts: [{ name: 'ZIP / ZINB', why: 'Excess zeros.' }] } },
  'result-linear': { result: { name: 'Ordinary Least Squares (OLS) Regression', just: 'Continuous outcome + predictors.', refs: ['Wooldridge 2006'], assumptions: ['Linearity', 'Homoscedasticity', 'Normality of errors', 'No perfect multicollinearity'], alts: [{ name: 'Robust SE', why: 'Heteroscedasticity-consistent.' }, { name: 'Quantile', why: 'Predict median or percentiles.' }] } },
  'result-pearson': {
    q: 'Correlation / Prediction direction?',
    options: [
      { label: '2 continuous variables correlation', value: 'cor', next: 'cor-n' },
      { label: 'Predict continuous outcome (linear model)', value: 'pred', next: 'result-linear' },
      { label: 'Predict binary outcome', value: 'bin', next: 'result-logistic' },
    ],
  },
  'cor-n': {
    q: 'Both variables normally distributed?',
    options: [
      { label: 'Yes (bivariate normal)', value: true, next: 'result-pearson2' },
      { label: 'No / Ordinal ranks', value: false, next: 'result-spearman' },
      { label: 'Both ordinal (tables)', value: 'ord', next: 'result-kendall' },
    ],
  },
  'result-pearson2': { result: { name: 'Pearson Product-Moment Correlation (r)', just: 'Linear association of bivariate normal continuous variables.', refs: ['Cohen 1988'], assumptions: ['Bivariate normality', 'Linear relation', 'No outliers leverage'], alts: [{ name: 'Spearman ρ', why: 'Robust to outliers.' }] } },
  'result-spearman': { result: { name: 'Spearman ρ Rank Correlation', just: 'Monotonic relationship, robust to outliers / non-normal.', refs: ['Conover 1999'], assumptions: ['Monotonicity'], alts: [{ name: 'Kendall τ-b', why: 'Small N, ordinal tables.' }] } },
  'result-kendall': { result: { name: 'Kendall τ-b / τ-c', just: 'Ordinal association; ties handled.', refs: ['Agresti 2002'], assumptions: ['Independence'], alts: [{ name: 'Gamma / Somers d', why: 'For asymmetric ordinal prediction.' }] } },
  'result-roc': { result: { name: 'ROC Curve + AUC + Optimal Cutoff (Youden J)', just: 'Discrimination & optimal tradeoff between Sensitivity vs Specificity.', refs: ['ROC Handbook: Pepe 2003'], assumptions: ['Gold standard defined', 'Independence of cases'], alts: [{ name: 'Precision-Recall (PR) Curve', why: 'Class imbalance better measure.' }] } },
};

function StatTestTree() {
  const [path, setPath] = useState<TreeNodeState[]>([{ nodeId: 'start', answerValue: null }]);
  const current = path[path.length - 1];
  const node = TREE[current.nodeId];
  const goBack = () => setPath(p => (p.length > 1 ? p.slice(0, -1) : p));
  const pickAnswer = (val: string | number | boolean, next: string) => {
    setPath(p => {
      const last = [...p];
      last[last.length - 1] = { ...last[last.length - 1], answerValue: val };
      last.push({ nodeId: next, answerValue: null });
      return last;
    });
  };
  const restart = () => setPath([{ nodeId: 'start', answerValue: null }]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Workflow className="h-4 w-4 text-fuchsia-300" /> Interactive Statistical Test Selection Tree</h2>
          <div className="flex items-center gap-2">
            {path.length > 1 && (
              <button onClick={goBack} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">← Back</button>
            )}
            <button onClick={restart} className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20">Restart</button>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
          {path.slice(0, -1).map((p, i) => (
            <div key={i} className="flex items-center gap-1 shrink-0">
              <div className="rounded-full bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30 px-2.5 py-1 text-[11px] font-medium">Q{i + 1} — {String(p.answerValue)}</div>
              <ChevronRight className="h-3 w-3 text-slate-600" />
            </div>
          ))}
          <div className="rounded-full bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30 px-2.5 py-1 text-[11px] font-medium shrink-0">Q{path.length} — Active</div>
        </div>

        {node && node.q ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Question {path.length}</div>
            <h3 className="text-xl font-semibold text-slate-100 mb-5">{node.q}</h3>
            <div className="grid gap-2">
              {node.options?.map((opt: TreeOption, i: number) => (
                <button
                  key={i}
                  onClick={() => pickAnswer(opt.value, opt.next)}
                  className="group flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-left hover:bg-indigo-500/10 hover:border-indigo-500/40 transition"
                >
                  <div className="mt-0.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-mono text-slate-400 group-hover:text-indigo-300">{i + 1}</div>
                  <div className="text-slate-200">{String(opt.label)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : node && node.result ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5">
            <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Recommended Test</div>
            <h3 className="text-2xl font-bold text-emerald-200">{node.result.name}</h3>
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Scientific Justification</div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{node.result.just}</p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                <div className="text-[11px] uppercase tracking-wider text-sky-400 mb-2">Critical Assumptions</div>
                <ul className="text-xs text-slate-200 space-y-1">
                  {node.result.assumptions.map((a: string, i: number) => <li key={i} className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-sky-300" /> {a}</li>)}
                </ul>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="text-[11px] uppercase tracking-wider text-amber-400 mb-2">Alternative Tests &amp; Why Rejected</div>
                <ul className="text-xs text-slate-200 space-y-2">
                  {node.result.alts.map((a: TreeResult['alts'][number], i: number) => (
                    <li key={i}>
                      <div className="font-semibold text-slate-100">{a.name}</div>
                      <div className="text-[11px] text-slate-400">{a.why}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1"><BookMark className="h-3.5 w-3.5" /> Supporting References</div>
              <ul className="text-xs text-slate-300 space-y-1 list-decimal list-inside">{node.result.refs.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 content-start">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-base font-semibold flex items-center gap-2"><ScaleBadge scale="nominal" /> Outcome Type Detection Helper</h3>
          <p className="text-xs text-slate-400 mt-1">Classify each variable — this is used upstream by the Test Tree.</p>
          <div className="mt-3 grid gap-2">
            {(['ratio', 'ordinal', 'binary', 'count', 'time_to_event', 'nominal'] as MeasurementScale[]).map(s => (
              <div key={s} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <ScaleBadge scale={s} />
                <span className="text-xs text-slate-300 flex-1">{SCALE_STYLES[s].icon} Example: {scaleExample(s)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-base font-semibold flex items-center gap-2"><MessageSquareCode className="h-4 w-4 text-emerald-300" /> Assumptions Quick Checklist</h3>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
            <li>• Shapiro-Wilk / Q-Q plot — check normality within each group</li>
            <li>• Levene / Brown-Forsythe — check homogeneity of variances</li>
            <li>• Mauchly — sphericity for RM-ANOVA; else GG correction</li>
            <li>• Schoenfeld residuals — proportional hazards for Cox</li>
            <li>• VIF ≤ 5 — no multicollinearity in multi-variable models</li>
            <li>• Breusch-Pagan — homoscedasticity for linear regression</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function scaleExample(s: MeasurementScale) {
  switch (s) {
    case 'ratio': return 'PD mm, Age, VAS 0-100 mm, Weight';
    case 'ordinal': return 'Success scale (Poor/Fair/Good/Excellent), VAS Likert 1-5';
    case 'nominal': return 'Gender, Study Site, Material Type, Tooth Type';
    case 'binary': return 'BoP Y/N, Implant Success (Y/N), Disease Present';
    case 'count': return 'Number of missing teeth, DMFT count, #adverse events';
    case 'time_to_event': return 'Time to implant failure, days-to-healing, OS/PFS';
    default: return '—';
  }
}

function BookMark(props: any) { return <span {...props}>🔖</span>; }

/* =============================================================== */
/* ======================= MISSING DATA TAB ===================== */
/* =============================================================== */

function MissingDataTab() {
  const { token } = useAuth();
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [apiResult, setApiResult] = useState<MissingDataApiResult | null>(null);
  const demoColumns: MissingDataColumn[] = apiResult?.columnsAnalysis ?? genDemoMissingColumns();

  const runMissingDataAnalysis = async () => {
    if (!datasetFile || !token) {
      setLoadError('اختر ملف بيانات أولًا قبل تشغيل Missing Data Analysis.');
      return;
    }

    try {
      setIsAnalyzing(true);
      setLoadError('');
      const formData = new FormData();
      formData.append('file', datasetFile);
      const response = await fetch(`${apiBaseUrl}/analytics/missing-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to analyze missing data');
      }

      setApiResult((await response.json()) as MissingDataApiResult);
    } catch {
      setLoadError('تعذر تحليل الملف الحالي؛ تم إبقاء العرض التوضيحي الافتراضي كمرجع فقط.');
      setApiResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const summaryByCat = useMemo(() => {
    const mcar = demoColumns.filter(c => c.patternClassification === 'MCAR').length;
    const mar = demoColumns.filter(c => c.patternClassification === 'MAR').length;
    const mnar = demoColumns.filter(c => c.patternClassification === 'MNAR').length;
    const total = demoColumns.reduce((a, c) => a + c.missingCount, 0);
    return {
      mcar, mar, mnar, total,
      columns: demoColumns.length,
      criticalCols: demoColumns.filter(c => c.missingPercentage > 30).length,
    };
  }, [demoColumns]);

  const donut = [
    { name: 'MCAR (Random)', value: summaryByCat.mcar, color: '#22c55e' },
    { name: 'MAR (Predictable)', value: summaryByCat.mar, color: '#eab308' },
    { name: 'MNAR (Informative)', value: summaryByCat.mnar, color: '#ef4444' },
  ];

  const missingHeatmap = demoColumns.map(c => ({
    column: c.column,
    missing: c.missingPercentage,
    filled: Math.max(0, 100 - c.missingPercentage),
    rec: c.recommendedTreatmentCode,
  }));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-300" /> Missing Data Analysis — Patterns &amp; Treatments</h2>
          <span className="rounded-full bg-amber-500/15 px-3 py-0.5 text-xs text-amber-300 ring-1 ring-inset ring-amber-500/20">{summaryByCat.total} missing cells</span>
        </div>
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Dataset file</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.sav"
                onChange={(event) => setDatasetFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <button
              onClick={() => void runMissingDataAnalysis()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isAnalyzing || !datasetFile}
            >
              {isAnalyzing ? 'Analyzing...' : 'Run Missing Data Analysis'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {apiResult
              ? `Loaded real dataset analysis for ${apiResult.summary.rows} rows and ${apiResult.summary.columns} columns.`
              : 'If no dataset is uploaded, the workspace keeps a demonstration view for guidance.'}
          </p>
          {loadError ? <p className="mt-2 text-xs text-rose-300">{loadError}</p> : null}
        </div>

        <div className="grid grid-cols-5 gap-3 mb-5">
          <StatMini label="Total Columns" value={String(summaryByCat.columns)} accent="text-slate-300" />
          <StatMini label="MCAR" value={String(summaryByCat.mcar)} accent="text-emerald-300" />
          <StatMini label="MAR" value={String(summaryByCat.mar)} accent="text-amber-300" />
          <StatMini label="MNAR" value={String(summaryByCat.mnar)} accent="text-rose-300" />
          <StatMini label="Missing >30%" value={String(summaryByCat.criticalCols)} accent="text-fuchsia-300" />
        </div>

        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Column</th>
                <th className="px-3 py-2 text-left">Missing (n)</th>
                <th className="px-3 py-2 text-left">Missing (%)</th>
                <th className="px-3 py-2 text-left">Completeness</th>
                <th className="px-3 py-2 text-left">Pattern</th>
                <th className="px-3 py-2 text-left">Confidence</th>
                <th className="px-3 py-2 text-left">Recommended Treatment</th>
              </tr>
            </thead>
            <tbody>
              {demoColumns.map(c => {
                const justification = c.justification?.trim();
                return (
                <tr key={c.column} className="border-t border-slate-800 hover:bg-slate-900/50">
                  <td className="px-4 py-2 font-mono text-slate-200">{c.column}</td>
                  <td className="px-3 py-2 text-slate-300 font-mono">{c.missingCount}</td>
                  <td className={'px-3 py-2 font-mono ' + (c.missingPercentage > 30 ? 'text-rose-300' : c.missingPercentage > 10 ? 'text-amber-300' : 'text-slate-300')}>{c.missingPercentage.toFixed(1)}%</td>
                  <td className="px-3 py-2 w-40">
                    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: Math.max(0, 100 - c.missingPercentage) + '%',
                          background: c.missingPercentage > 30 ? '#f43f5e' : c.missingPercentage > 10 ? '#f59e0b' : '#10b981',
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {c.patternClassification === 'MCAR' && <SeverityBadge severity="low" />}
                    {c.patternClassification === 'MAR' && <SeverityBadge severity="moderate" />}
                    {c.patternClassification === 'MNAR' && <SeverityBadge severity="critical" />}
                    <span className="ml-2 text-xs text-slate-300">{c.patternClassification}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{(c.classificationConfidence * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-slate-200">{c.recommendedTreatment}</div>
                    <div className="font-mono text-[10px] text-indigo-300">{c.recommendedTreatmentCode}</div>
                    {justification ? <div className="mt-1 text-[10px] text-slate-400">{justification}</div> : null}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 p-4 bg-slate-950/50">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><PieChart className="h-4 w-4 text-violet-300" /> Pattern Classification Distribution</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RePie>
                  <Pie data={donut} dataKey="value" nameKey="name" outerRadius={80} innerRadius={50} paddingAngle={2}>
                    {donut.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                  </Pie>
                  <ReTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                </RePie>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {donut.map(d => (
                <div key={d.name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.color }} /> {d.name}: {d.value}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 p-4 bg-slate-950/50">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><BarChart3 className="h-4 w-4 text-sky-300" /> Completeness per Column</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={missingHeatmap}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="column" stroke="#64748b" fontSize={10} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <ReTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="filled" stackId="a" fill="#10b981" name="Data Present %" />
                  <Bar dataKey="missing" stackId="a" fill="#ef4444" name="Missing %" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 content-start">
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
          <h3 className="text-base font-semibold text-rose-200 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> If MNAR is detected</h3>
          <p className="text-xs mt-1 text-slate-300 leading-relaxed">
            If missingness is <strong>informative (MNAR)</strong> — the reason for missingness is itself related to outcome (e.g., a patient drops out because treatment failed). In this case:
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-200">
            <li>• Report the missing mechanism explicitly in the protocol / SAP</li>
            <li>• Pre-specified <strong>tipping-point / delta-adjustment sensitivity analysis</strong> is mandatory per ICH E9(R1)</li>
            <li>• Report worst-case / best-case scenario as reference bounds</li>
            <li>• Avoid simple Complete-Case or Mean imputation for MNAR</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-base font-semibold flex items-center gap-1"><Zap className="h-4 w-4 text-emerald-300" /> Decision Guide — Treatment Algorithm</h3>
          <ol className="mt-2 space-y-2 text-xs text-slate-300 list-decimal list-inside">
            <li><strong>If missing &lt; 5%</strong>: Complete-case acceptable (document as limitation).</li>
            <li><strong>5–30% and MCAR/MAR</strong>: <strong>MICE</strong> recommended (m=20 imputations, fully conditional specification).</li>
            <li><strong>5–30% and longitudinal</strong>: Consider Joint Modeling / <strong>FCS for MLM</strong>, or MLM with REML (robust to MAR via likelihood-based).</li>
            <li><strong>&gt; 30% missing</strong>: Treat with extreme caution. Consider: Multiple imputation + documented Delta / tipping-point sensitivity analysis per ICH E9(R1) estimand.</li>
            <li><strong>Last observation carried forward (LOCF)</strong>: Only as a sensitivity analysis — NEVER primary (FDA guidance).</li>
          </ol>
        </div>
        <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-5">
          <h3 className="text-base font-semibold text-indigo-200 flex items-center gap-1"><Info className="h-4 w-4" /> ICH E9(R1) Reminder</h3>
          <p className="text-xs mt-1 text-slate-300 leading-relaxed">
            Define the <strong>treatment policy, hypothetical, composite, or while-on-treatment estimand</strong> <em>a priori</em>. Intercurrent events (IIT dropout, non-adherence, rescue medication) must be handled consistently with the estimand, not just &quot;imputed&quot;.
          </p>
        </div>
      </div>
    </div>
  );
}

function genDemoMissingColumns(): MissingDataColumn[] {
  const demoCols = [
    { col: 'Age', mc: 1, pct: 0.5, pattern: 'MCAR' as const, conf: 0.85, rec: 'Complete case acceptable', code: 'complete_case' },
    { col: 'Gender', mc: 0, pct: 0, pattern: 'MCAR' as const, conf: 0.95, rec: 'No action needed', code: 'none' },
    { col: 'Baseline_PD', mc: 12, pct: 6.0, pattern: 'MAR' as const, conf: 0.75, rec: 'MICE (20 imputations, predictive mean matching)', code: 'mice' },
    { col: 'Smoking_Status', mc: 30, pct: 15.0, pattern: 'MAR' as const, conf: 0.68, rec: 'MICE with logistic chain + Center as predictor', code: 'mice' },
    { col: 'VAS_Pain_Day7', mc: 41, pct: 20.5, pattern: 'MAR' as const, conf: 0.72, rec: 'MMRM (mixed model repeated measures) — likelihood-based MAR', code: 'mice' },
    { col: 'PD_6mo', mc: 78, pct: 39.0, pattern: 'MNAR' as const, conf: 0.6, rec: 'Primary: MICE + Delta-adjustment sensitivity; Secondary: Tipping-point worst/best-case', code: 'sensitivity' },
    { col: 'BoP_6mo', mc: 74, pct: 37.0, pattern: 'MNAR' as const, conf: 0.55, rec: 'Impute under MAR + Documented Delta = 0.5 shift worst-case', code: 'sensitivity' },
    { col: 'Adverse_Event', mc: 3, pct: 1.5, pattern: 'MCAR' as const, conf: 0.9, rec: 'No action needed', code: 'none' },
    { col: 'HbA1c_Lab', mc: 58, pct: 29.0, pattern: 'MAR' as const, conf: 0.7, rec: 'MICE predictive mean matching, condition on center & age', code: 'mice' },
    { col: 'Implant_Failure_Time', mc: 9, pct: 4.5, pattern: 'MCAR' as const, conf: 0.82, rec: 'Cox-PH on observed; Kaplan-Meier as sensitivity', code: 'complete_case' },
  ];
  return demoCols.map(d => ({
    column: d.col,
    missingCount: d.mc,
    missingPercentage: d.pct,
    patternClassification: d.pattern,
    classificationConfidence: d.conf,
    recommendedTreatment: d.rec,
    recommendedTreatmentCode: d.code as MissingDataPattern['recommendedTreatmentCode'],
  }));
}
