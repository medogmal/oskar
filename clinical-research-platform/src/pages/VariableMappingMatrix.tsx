import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Search,
  Table2,
  Trash2,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Printer,
  X,
  ChevronRight,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { CategoryBadge, ScaleBadge } from '../components/SeverityBadges';
import type {
  MeasurementScale,
  VariableMapping,
  VariableRole,
  VariableSource,
  ValidationItem,
  SeverityLevel,
  ErrorCategory,
} from '../types/clinresearch';
import { exportVariablesMatrixCsv, exportReportPdf, exportReportXlsx, buildBlankReport } from '../lib/exportLib';
import { SEVERITY_STYLES } from '../lib/severityHelpers';
import { apiBaseUrl } from '../lib/auth';
import { loadWorkspaceData, uploadWorkspaceData } from '../lib/studyWorkspaceFiles';

type RoleOption = { value: VariableRole; label: string };
type SourceOption = { value: VariableSource; label: string };
type ScaleOption = { value: MeasurementScale; label: string };

const ROLES: RoleOption[] = [
  { value: 'primary_outcome', label: 'Primary Outcome' },
  { value: 'secondary_outcome', label: 'Secondary Outcome' },
  { value: 'independent', label: 'Independent (Predictor)' },
  { value: 'dependent', label: 'Dependent (Response)' },
  { value: 'confounder', label: 'Confounder' },
  { value: 'covariate', label: 'Covariate' },
  { value: 'effect_modifier', label: 'Effect Modifier' },
  { value: 'mediator', label: 'Mediator' },
  { value: 'baseline', label: 'Baseline' },
  { value: 'demographic', label: 'Demographic' },
  { value: 'identifier', label: 'Identifier (Admin)' },
];

const SOURCES: SourceOption[] = [
  { value: 'patient_self_report', label: 'Patient Self Report' },
  { value: 'clinical_examination', label: 'Clinical Examination' },
  { value: 'medical_record', label: 'Medical Record' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'questionnaire', label: 'Questionnaire' },
  { value: 'physician_assessment', label: 'Physician Assessment' },
  { value: 'study_device', label: 'Study Device' },
  { value: 'administrative', label: 'Administrative' },
];

const SCALES: ScaleOption[] = [
  { value: 'nominal', label: 'Nominal' },
  { value: 'ordinal', label: 'Ordinal' },
  { value: 'interval', label: 'Interval' },
  { value: 'ratio', label: 'Ratio' },
  { value: 'binary', label: 'Binary (Yes/No)' },
  { value: 'count', label: 'Count (Discrete)' },
  { value: 'time_to_event', label: 'Time to Event / Survival' },
];

const roleLabel = (value: string) => ROLES.find(r => r.value === value)?.label ?? value;
const sourceLabel = (value: string) => SOURCES.find(s => s.value === value)?.label ?? value;

export default function VariableMappingMatrix() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: studyId = 'demo' } = useParams();
  const [variables, setVariables] = useState<VariableMapping[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [selectedVar, setSelectedVar] = useState<VariableMapping | null>(null);
  const [consistency, setConsistency] = useState<ValidationItem[]>([]);
  const [rqs, setRqs] = useState<{ id: string; text: string; type: string }[]>([]);
  const [objectives, setObjectives] = useState<{ id: string; text: string; type: string }[]>([]);
  const [consistencyChecked, setConsistencyChecked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const pendingReferenceId = searchParams.get('reference') ?? '';

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setSaveError('');
        const [variablesResponse, loadedRqs, loadedObjectives] = await Promise.all([
          fetch(`${apiBaseUrl}/studies/${studyId}/variable-matrix`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          loadWorkspaceData<{ id: string; text: string; type: string }[]>(studyId, token, 'research-questions', []),
          loadWorkspaceData<{ id: string; text: string; type: string }[]>(studyId, token, 'objectives', []),
        ]);

        const loadedVariables = variablesResponse.ok
          ? ((await variablesResponse.json()) as VariableMapping[])
          : await loadWorkspaceData<VariableMapping[]>(studyId, token, 'variables', []);

        if (cancelled) {
          return;
        }

        setVariables(loadedVariables);
        setRqs(loadedRqs);
        setObjectives(loadedObjectives);
        setConsistencyChecked(false);
        setSelectedVar(null);
        setHasLoaded(true);
      } catch {
        if (!cancelled) {
          setSaveError('تعذر تحميل بيانات Variable Matrix من الدراسة الحالية.');
          setVariables([]);
          setRqs([]);
          setObjectives([]);
          setHasLoaded(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId, token]);

  useEffect(() => {
    if (!token || !hasLoaded) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setIsSaving(true);
        setSaveError('');
        const response = await fetch(`${apiBaseUrl}/studies/${studyId}/variable-matrix`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ variables }),
        });

        if (!response.ok) {
          await uploadWorkspaceData(studyId, token, 'variables', variables);
        }
      } catch {
        setSaveError('تعذر حفظ تعديلات Variable Matrix على الدراسة.');
      } finally {
        setIsSaving(false);
      }
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasLoaded, studyId, token, variables]);

  const filtered = useMemo(() => {
    let out = variables;
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(v =>
        v.label.toLowerCase().includes(s) ||
        v.definition.toLowerCase().includes(s) ||
        v.recommendedStatisticalTest.toLowerCase().includes(s) ||
        v.measurementMethod.toLowerCase().includes(s)
      );
    }
    if (roleFilter) out = out.filter(v => v.role === roleFilter);
    return out;
  }, [variables, search, roleFilter]);

  const addNewVariable = () => {
    const now = new Date().toISOString();
    const v: VariableMapping = {
      id: crypto.randomUUID(),
      studyId,
      label: `New Variable (${variables.length + 1})`,
      definition: '',
      role: 'covariate',
      scale: 'nominal',
      source: 'clinical_examination',
      measurementMethod: '',
      unit: '',
      linkedOutcomeIds: [],
      linkedResearchQuestionIds: [],
      linkedReferenceIds: [],
      recommendedStatisticalTest: '',
      section: '',
      responseType: 'numeric',
      createdAt: now,
      updatedAt: now,
    };
    const next = [v, ...variables];
    setVariables(next);
    setSelectedVar(v);
  };

  const updateVar = (id: string, patch: Partial<VariableMapping>) => {
    const next = variables.map(item =>
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
    );
    setVariables(next);
    if (selectedVar && selectedVar.id === id) {
      setSelectedVar(next.find(x => x.id === id) ?? null);
    }
  };

  const removeVar = (id: string) => {
    if (!confirm('Delete this variable? This action cannot be undone.')) return;
    const next = variables.filter(item => item.id !== id);
    setVariables(next);
    if (selectedVar && selectedVar.id === id) setSelectedVar(null);
  };

  const applyPendingReference = () => {
    if (!pendingReferenceId || !selectedVar) {
      return;
    }

    const nextReferenceIds = Array.from(new Set([...selectedVar.linkedReferenceIds, pendingReferenceId]));
    updateVar(selectedVar.id, { linkedReferenceIds: nextReferenceIds });
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('reference');
    setSearchParams(nextParams, { replace: true });
  };

  const runConsistencyCheck = () => {
    const issues: ValidationItem[] = [];
    const labels = variables.map(v => v.label.trim().toLowerCase());
    const seen = new Set<string>();
    labels.forEach((l, i) => {
      if (seen.has(l)) {
        issues.push({
          id: 'c-dup-' + i,
          studyId,
          severity: 'moderate',
          category: 'crf_structural',
          status: 'open',
          title: 'Duplicate Variable Label: ' + variables[i].label,
          detail: 'Two or more variables share the exact label. This indicates a possible duplicate CRF field and increases data-entry burden.',
          suggestedAction: 'Rename to distinct names or remove one duplicate field.',
          location: { fieldLabel: variables[i].label },
          createdAt: new Date().toISOString(),
        });
      } else seen.add(l);
    });
    variables.forEach((v, i) => {
      if (v.definition.trim().length < 10) {
        issues.push({
          id: 'c-def-' + i,
          studyId,
          severity: 'high',
          category: 'crf_structural',
          status: 'open',
          title: 'Missing Operational Definition — ' + v.label,
          detail: 'The variable lacks a precise operational definition. This harms reproducibility and inter-rater reliability.',
          suggestedAction: 'Describe the measurement instrument, calibrations, precise time-point, and unit definition.',
          location: { fieldLabel: v.label },
          createdAt: new Date().toISOString(),
        });
      }
      if ((v.role === 'primary_outcome' || v.role === 'secondary_outcome')) {
        if (v.linkedResearchQuestionIds.length === 0) {
          issues.push({
            id: 'c-rq-' + i,
            studyId,
            severity: 'critical',
            category: 'methodological',
            status: 'open',
            title: 'Outcome variable ' + v.label + ' not linked to any Research Question',
            detail: 'Every primary and secondary outcome MUST be explicitly linked to at least one research question per ICH E9.',
            suggestedAction: 'Edit this variable on the right panel and select at least one research question.',
            location: { fieldLabel: v.label },
            createdAt: new Date().toISOString(),
          });
        }
      }
      if ((v.scale === 'ratio' || v.scale === 'interval' || v.scale === 'count') && v.unit.trim() === '') {
        issues.push({
          id: 'c-unit-' + i,
          studyId,
          severity: 'high',
          category: 'statistical',
          status: 'open',
          title: 'Missing Unit for numeric-scale variable: ' + v.label,
          detail: 'All numeric variables on ratio/interval/count scales require an explicit unit of measurement.',
          suggestedAction: 'Define a unit (mm, years, kg, mg/dL, count, etc.) in the "Unit" field.',
          location: { fieldLabel: v.label },
          createdAt: new Date().toISOString(),
        });
      }
    });
    setConsistency(issues);
    setConsistencyChecked(true);
  };

  const exportMatrix = () => exportVariablesMatrixCsv(variables, 'variable-matrix-' + studyId);
  const buildMatrixReport = () => {
    const report = buildBlankReport('crf_review', studyId, 'Variable Mapping Matrix Report', user?.fullName ?? 'Research Platform');
    report.sections = [
      {
        id: 'summary',
        heading: '1. Matrix Summary',
        level: 1,
        body: 'This variable mapping matrix documents every planned variable with operational definition, measurement scale, source, unit, and linkage to Research Questions and References.',
        highlights: [
          'Total variables: ' + variables.length,
          'Linked to RQs: ' + variables.filter(v => v.linkedResearchQuestionIds.length > 0).length,
          'Missing operational definition: ' + variables.filter(v => v.definition.trim().length < 10).length,
          'Missing numeric unit: ' + variables.filter(v => (v.scale === 'ratio' || v.scale === 'interval' || v.scale === 'count') && v.unit.trim() === '').length,
        ],
        tables: [
          {
            caption: 'Variables by Role',
            columns: ['Role', 'Count'],
            rows: ROLES.map(r => [r.label, variables.filter(v => v.role === r.value).length]),
          },
          {
            caption: 'Variables Matrix (sample rows)',
            columns: ['Label', 'Role', 'Scale', 'Source', 'Unit', 'Linked RQs', 'Linked Refs'],
            rows: variables.slice(0, Math.min(20, variables.length)).map(v => [
              v.label,
              roleLabel(v.role),
              v.scale,
              sourceLabel(v.source),
              v.unit || '-',
              v.linkedResearchQuestionIds.join('; ') || '-',
              v.linkedReferenceIds.join('; ') || '-',
            ]),
          },
        ],
      },
    ];
    return report;
  };

  const exportMatrixReportPdf = async () => {
    if (!token) {
      return;
    }
    await exportReportPdf(buildMatrixReport(), token);
  };

  const exportMatrixReportXlsx = async () => {
    if (!token) {
      return;
    }
    await exportReportXlsx(buildMatrixReport(), token);
  };

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav(studyId)}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate('/studies/' + studyId)} className="inline-flex items-center gap-1 rounded-md text-sm text-slate-400 hover:text-slate-200">
              <ArrowLeft className="h-4 w-4" /> Back to study
            </button>
            <div className="flex items-center gap-2">
              <Table2 className="h-5 w-5 text-indigo-400" />
              <h1 className="text-lg font-semibold text-slate-100">Variable Mapping Matrix</h1>
            </div>
            <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-300 ring-1 ring-inset ring-indigo-500/20">{variables.length} variables</span>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300 ring-1 ring-inset ring-slate-700">
              {isLoading ? 'Loading...' : isSaving ? 'Saving...' : 'Synced to study'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search variables…"
                className="w-64 rounded-lg border border-slate-700 bg-slate-900/50 pl-8 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none">
              <option value="">All roles</option>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button onClick={runConsistencyCheck} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20">
              <AlertTriangle className="h-4 w-4" /> Check Consistency
            </button>
            <button onClick={exportMatrix} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
              <FileSpreadsheet className="h-4 w-4" /> Export CSV
            </button>
            <button onClick={() => void exportMatrixReportPdf()} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/20">
              <Printer className="h-4 w-4" /> Export PDF
            </button>
            <button onClick={() => void exportMatrixReportXlsx()} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-500/20">
              <FileSpreadsheet className="h-4 w-4" /> Export XLSX
            </button>
            <button onClick={addNewVariable} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900 hover:bg-indigo-400">
              <Plus className="h-4 w-4" /> Add Variable
            </button>
          </div>
        </header>

        {saveError ? (
          <div className="border-b border-rose-500/20 bg-rose-500/10 px-6 py-3 text-sm text-rose-200">{saveError}</div>
        ) : null}

        {pendingReferenceId ? (
          <div className="border-b border-sky-500/20 bg-sky-500/10 px-6 py-3 text-sm text-sky-200">
            Reference ready to link: <code className="font-mono">{pendingReferenceId}</code>
            <button
              onClick={applyPendingReference}
              disabled={!selectedVar}
              className="ml-3 rounded-md border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedVar ? `Attach to ${selectedVar.label}` : 'Select a variable first'}
            </button>
          </div>
        ) : null}

        {consistencyChecked && (
          <div className="grid gap-3 border-b border-slate-800 bg-slate-900/70 px-6 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-amber-300" />
              <strong className="text-slate-200">Consistency Check Results</strong>
              <span className="text-slate-400">·</span>
              <span className={consistency.length === 0 ? 'text-emerald-300' : 'text-amber-300'}>
                {consistency.length === 0 ? 'All checks passed — no structural issues detected.' : consistency.length + ' issue(s) found.'}
              </span>
            </div>
            {consistency.length > 0 && (
              <div className="mt-2 grid gap-2">
                {consistency.map(issue => {
                  const sev = SEVERITY_STYLES[issue.severity as SeverityLevel];
                  return (
                    <div key={issue.id} className={`rounded-lg border p-3 ${sev.bg} ${sev.ring}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-slate-100">{issue.title}</div>
                        <CategoryBadge category={issue.category as ErrorCategory} />
                        <span className="ml-auto text-xs text-slate-400">{issue.location?.fieldLabel}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-300">{issue.detail}</div>
                      {issue.suggestedAction && (
                        <div className="mt-2 rounded-md bg-slate-950/50 px-3 py-2 text-[11px] text-emerald-300">
                          <ChevronRight className="inline h-3 w-3" /> {issue.suggestedAction}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="grid flex-1 gap-4 px-6 py-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,380px)]">
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <div className="overflow-auto max-h-[calc(100vh-260px)]">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
                  <tr className="text-xs uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Variable</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Scale</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Unit</th>
                    <th className="px-3 py-3">RQs</th>
                    <th className="px-3 py-3">Refs</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => (
                    <tr
                      key={v.id}
                      onClick={() => setSelectedVar(v)}
                      className={`cursor-pointer border-b border-slate-800/70 hover:bg-slate-900/60 ${selectedVar && selectedVar.id === v.id ? 'bg-indigo-500/5 ring-1 ring-inset ring-indigo-500/20' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{v.label}</div>
                        <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{v.definition || '— no definition yet'}</div>
                        {v.section && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">Section: {v.section}</div>}
                      </td>
                      <td className="px-3 py-3"><span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">{roleLabel(v.role)}</span></td>
                      <td className="px-3 py-3"><ScaleBadge scale={v.scale} /></td>
                      <td className="px-3 py-3 text-xs text-slate-400">{sourceLabel(v.source)}</td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-300">{v.unit || '—'}</td>
                      <td className="px-3 py-3 text-xs">
                        {v.linkedResearchQuestionIds.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" /> {v.linkedResearchQuestionIds.length}
                          </span>
                        ) : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {v.linkedReferenceIds.length > 0 ? (
                          <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">{v.linkedReferenceIds.length}</span>
                        ) : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); removeVar(v.id); }}
                          className="rounded-md border border-slate-700 p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" /> No variables matching the filters.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {!selectedVar ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-slate-500">
                <Table2 className="mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm">Select a variable on the left to view &amp; edit every attribute, or click <strong>Add Variable</strong> to start a new one.</p>
              </div>
            ) : (
              <VariableEditor
                variable={selectedVar}
                onChange={patch => updateVar(selectedVar.id, patch)}
                rqs={rqs}
                objectives={objectives}
                onClose={() => setSelectedVar(null)}
              />
            )}
          </aside>
        </div>
      </div>
    </ResearchWorkspaceShell>
  );
}

function VariableEditor({
  variable,
  onChange,
  rqs,
  objectives,
  onClose,
}: {
  variable: VariableMapping;
  onChange: (patch: Partial<VariableMapping>) => void;
  rqs: { id: string; text: string }[];
  objectives: { id: string; text: string }[];
  onClose: () => void;
}) {
  const toggleStrArray = (
    key: 'linkedResearchQuestionIds' | 'linkedOutcomeIds' | 'linkedReferenceIds',
    val: string
  ) => {
    const current = variable[key];
    const next = current.includes(val) ? current.filter(x => x !== val) : [...current, val];
    const patch: Partial<VariableMapping> = {};
    patch[key] = next;
    onChange(patch);
  };

  return (
    <div className="flex h-full max-h-[calc(100vh-220px)] flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Editing</div>
          <div className="font-mono text-xs text-indigo-300">{variable.id}</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"><X className="h-4 w-4" /></button>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Label / Name</label>
        <input
          value={variable.label}
          onChange={e => onChange({ label: e.target.value })}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Operational Definition</label>
        <textarea
          value={variable.definition}
          onChange={e => onChange({ definition: e.target.value })}
          rows={3}
          className="mt-1 w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          placeholder="Measured using calibrated device X, by calibrated rater Y, at visit Z ..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Role</label>
          <select
            value={variable.role}
            onChange={e => onChange({ role: e.target.value as VariableRole })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Measurement Scale</label>
          <select
            value={variable.scale}
            onChange={e => onChange({ scale: e.target.value as MeasurementScale })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {SCALES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Data Source</label>
          <select
            value={variable.source}
            onChange={e => onChange({ source: e.target.value as VariableSource })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Unit of Measure</label>
          <input
            value={variable.unit}
            onChange={e => onChange({ unit: e.target.value })}
            placeholder="mm, years, mg/dL ..."
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Measurement Method</label>
        <textarea
          value={variable.measurementMethod}
          onChange={e => onChange({ measurementMethod: e.target.value })}
          rows={2}
          className="mt-1 w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Recommended Statistical Test</label>
        <input
          value={variable.recommendedStatisticalTest}
          onChange={e => onChange({ recommendedStatisticalTest: e.target.value })}
          placeholder="e.g., Mann-Whitney U with continuity correction..."
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">CRF Section</label>
          <input
            value={variable.section ?? ''}
            onChange={e => onChange({ section: e.target.value })}
            placeholder="Baseline / D7 / 6mo"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Response Type</label>
          <select
            value={variable.responseType ?? 'numeric'}
            onChange={e => onChange({ responseType: e.target.value as any })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="numeric">Numeric</option>
            <option value="choice">Choice (Categorical)</option>
            <option value="text">Text / Free Text</option>
            <option value="boolean">Boolean / Yes-No</option>
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={!!variable.required}
              onChange={e => onChange({ required: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
            />
            Required?
          </label>
        </div>
      </div>

      {variable.responseType === 'choice' && (
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Choice Options (one per line)</label>
          <textarea
            value={(variable.options ?? []).join('\n')}
            onChange={e => onChange({ options: e.target.value.split(/\r?\n/).filter(Boolean) })}
            rows={3}
            className="mt-1 w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
            placeholder="Option A&#10;Option B&#10;Option C"
          />
        </div>
      )}

      <div className="rounded-lg border border-slate-800 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">🔗 Link to Research Questions</div>
        {rqs.length === 0 && <p className="text-xs italic text-slate-500">Tip: Go to Study Structure page to add Research Questions first.</p>}
        <div className="grid gap-1.5">
          {rqs.map(rq => {
            const on = variable.linkedResearchQuestionIds.includes(rq.id);
            return (
              <label key={rq.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-xs text-slate-300 hover:bg-slate-900/70">
                <input type="checkbox" checked={on} onChange={() => toggleStrArray('linkedResearchQuestionIds', rq.id)} className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 text-indigo-500" />
                <span className="line-clamp-2">{rq.text}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">🔗 Link to Objectives</div>
        {objectives.length === 0 && <p className="text-xs italic text-slate-500">Tip: Go to Study Structure page to add Objectives first.</p>}
        <div className="grid gap-1.5">
          {objectives.map(obj => {
            const on = variable.linkedOutcomeIds.includes(obj.id);
            return (
              <label key={obj.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-xs text-slate-300 hover:bg-slate-900/70">
                <input type="checkbox" checked={on} onChange={() => toggleStrArray('linkedOutcomeIds', obj.id)} className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 text-indigo-500" />
                <span className="line-clamp-2">{obj.text}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">🔗 Supporting Reference IDs (comma separated)</div>
        <input
          value={variable.linkedReferenceIds.join(', ')}
          onChange={e => onChange({ linkedReferenceIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
          placeholder="CONSORT_2010, ICH_E9, AAP_PERIODONTAL"
        />
      </div>
    </div>
  );
}
