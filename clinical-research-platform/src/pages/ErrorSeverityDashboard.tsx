import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  Info,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { CategoryBadge, SeverityBadge } from '../components/SeverityBadges';
import type { ValidationItem, SeverityLevel, ErrorCategory } from '../types/clinresearch';
type ValidationStatus = 'open' | 'resolved' | 'dismissed' | 'pending';
import { ERROR_CATALOG } from '../lib/studyStore';
import { exportErrorsCsv, openReportForPrint, buildBlankReport } from '../lib/exportLib';
import { SEVERITY_STYLES } from '../lib/severityHelpers';
import { loadWorkspaceData, uploadWorkspaceData } from '../lib/studyWorkspaceFiles';

export default function ErrorSeverityDashboard() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { id: studyId = 'demo' } = useParams();
  const [items, setItems] = useState<ValidationItem[]>([]);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | SeverityLevel>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ErrorCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ValidationStatus>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{
    id: string;
    notes: string;
    status: ValidationStatus;
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoadError('');
        const loaded = await loadWorkspaceData<ValidationItem[]>(studyId, token, 'validation-items', []);
        if (!cancelled) {
          setItems(loaded);
          setHasLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setLoadError('تعذر تحميل سجل المشكلات الحالي من الدراسة.');
          setHasLoaded(true);
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
        await uploadWorkspaceData(studyId, token, 'validation-items', items);
      } catch {
        setLoadError('تعذر حفظ تحديثات المشكلات على الدراسة.');
      }
    }, 600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasLoaded, items, studyId, token]);

  const stats = useMemo(() => {
    const s = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, open: 0, resolved: 0, dismissed: 0 };
    items.forEach(i => {
      if (i.severity === 'critical') s.critical++;
      if (i.severity === 'high') s.high++;
      if (i.severity === 'moderate') s.moderate++;
      if (i.severity === 'low') s.low++;
      if (i.severity === 'info') s.info++;
      if (i.status === 'open') s.open++;
      if (i.status === 'resolved') s.resolved++;
      if (i.status === 'dismissed') s.dismissed++;
    });
    return s;
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (severityFilter !== 'all') out = out.filter(i => i.severity === severityFilter);
    if (categoryFilter !== 'all') out = out.filter(i => i.category === categoryFilter);
    if (statusFilter !== 'all') out = out.filter(i => i.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(i =>
        i.title.toLowerCase().includes(s) ||
        i.detail.toLowerCase().includes(s) ||
        (i.suggestedAction ?? '').toLowerCase().includes(s)
      );
    }
    return out;
  }, [items, search, severityFilter, categoryFilter, statusFilter]);

  const changeStatus = (id: string, status: ValidationItem['status'], resolutionNotes?: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              resolutionNotes,
              resolvedBy: user?.fullName,
              resolvedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setResolving(null);
    setOpenItem(null);
  };

  const exportCsv = () => exportErrorsCsv(items, 'validation-issues-' + studyId);
  const printReport = () => {
    const report = buildBlankReport('errors_deficiencies', studyId, 'Deficiencies & Issues Audit Report', user?.fullName ?? 'Research Platform');
    report.sections = [
      {
        id: 'overview',
        heading: '1. Audit Overview',
        level: 1,
        body: 'This report lists all methodological, statistical, clinical and structural issues identified in the study. Severity classification and status are included with actionable corrections.',
        highlights: [
          'Total issues identified: ' + items.length,
          'Open: ' + stats.open + ' | Resolved: ' + stats.resolved + ' | Dismissed: ' + stats.dismissed,
          'Critical: ' + stats.critical + ' | High: ' + stats.high + ' | Moderate: ' + stats.moderate + ' | Low: ' + stats.low,
        ],
        tables: [
          {
            caption: 'Issues by Severity',
            columns: ['Severity', 'Count'],
            rows: [
              ['Critical', stats.critical],
              ['High', stats.high],
              ['Moderate', stats.moderate],
              ['Low', stats.low],
              ['Info', stats.info],
            ],
          },
          {
            caption: 'All Issues (full list)',
            columns: ['#', 'Severity', 'Category', 'Status', 'Title', 'Field'],
            rows: items.map((it, i) => [String(i + 1), it.severity, it.category, it.status, it.title, it.location?.fieldLabel ?? '-']),
          },
        ],
      },
    ];
    openReportForPrint(report);
  };

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav(studyId)}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        {loadError ? <div className="border-b border-rose-500/20 bg-rose-500/10 px-6 py-3 text-sm text-rose-200">{loadError}</div> : null}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate('/studies/' + studyId)} className="inline-flex items-center gap-1 rounded-md text-sm text-slate-400 hover:text-slate-200">
              <ArrowLeft className="h-4 w-4" /> Back to study
            </button>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-400" />
              <h1 className="text-lg font-semibold text-slate-100">Error &amp; Severity Dashboard</h1>
            </div>
            <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/20">{items.length} issues</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900 hover:bg-indigo-400">
              <Plus className="h-4 w-4" /> New Issue
            </button>
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
              <FileSpreadsheet className="h-4 w-4" /> Export CSV
            </button>
            <button onClick={printReport} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/20">
              <Printer className="h-4 w-4" /> Report / PDF
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 border-b border-slate-800 px-6 py-4 md:grid-cols-3 xl:grid-cols-7">
          <StatCard value={stats.critical} label="Critical" color="critical" icon={<ShieldAlert className="h-4 w-4" />} />
          <StatCard value={stats.high} label="High" color="high" icon={<AlertTriangle className="h-4 w-4" />} />
          <StatCard value={stats.moderate} label="Moderate" color="moderate" icon={<AlertCircle className="h-4 w-4" />} />
          <StatCard value={stats.low} label="Low" color="low" icon={<Info className="h-4 w-4" />} />
          <StatCard value={stats.info} label="Info" color="info" icon={<Info className="h-4 w-4" />} />
          <StatCard value={stats.open} label="Open" color="high" icon={<XCircle className="h-4 w-4" />} />
          <StatCard value={stats.resolved} label="Resolved" color="low" icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-6 py-3">
          <Filter className="h-4 w-4 text-slate-500" />
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search issues…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as any)} className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="moderate">Moderate</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as any)} className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200">
            <option value="all">All categories</option>
            <option value="methodological">Methodological</option>
            <option value="statistical">Statistical</option>
            <option value="clinical">Clinical</option>
            <option value="missing_data">Missing Data</option>
            <option value="regulatory">Regulatory</option>
            <option value="crf_structural">CRF Structural</option>
            <option value="reference_scope">Reference Scope</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="grid gap-2 max-w-6xl mx-auto">
            {filtered.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-500">
                <ShieldCheck className="mx-auto mb-2 h-10 w-10 opacity-40" />
                No issues match the current filters.
              </div>
            )}
            {filtered.map(it => {
              const open = openItem === it.id;
              const sev = SEVERITY_STYLES[it.severity as SeverityLevel];
              return (
                <div key={it.id} className={`rounded-xl border ${sev.ring} ${it.status === 'resolved' ? 'bg-slate-900/40 opacity-80' : 'bg-slate-900/70'}`}>
                  <button
                    onClick={() => setOpenItem(open ? null : it.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-900/80"
                  >
                    <div className="mt-0.5">{open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</div>
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <SeverityBadge severity={it.severity as SeverityLevel} />
                      <CategoryBadge category={it.category as ErrorCategory} />
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        it.status === 'resolved' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : it.status === 'dismissed' ? 'bg-slate-700/50 text-slate-300'
                        : it.status === 'pending' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      }`}>
                        {it.status === 'resolved' && <CheckCircle2 className="h-3 w-3" />}
                        {it.status}
                      </span>
                      <span className="font-medium text-slate-100 truncate">{it.title}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
                      {it.location?.fieldLabel && <span className="font-mono text-[10px] rounded bg-slate-800 px-1.5 py-0.5">{it.location.fieldLabel}</span>}
                      {it.createdAt && <span>{new Date(it.createdAt).toLocaleDateString()}</span>}
                      <button
                        onClick={e => { e.stopPropagation(); if (confirm('Permanently delete this issue?')) { setItems((current) => current.filter((entry) => entry.id !== it.id)); } }}
                        className="ml-1 rounded-md p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                      ><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </button>
                  {open && (
                    <div className="grid gap-4 border-t border-slate-800/80 bg-slate-950/50 px-6 py-4 md:grid-cols-[minmax(0,3fr)_220px]">
                      <div className="grid gap-4">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Details</div>
                          <p className="text-sm text-slate-200 whitespace-pre-wrap">{it.detail}</p>
                        </div>
                        {it.suggestedAction && (
                          <div className={`rounded-lg p-3 ${sev.bg}`}>
                            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Suggested Correction</div>
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{it.suggestedAction}</p>
                          </div>
                        )}
                        {it.errorEntry && (
                          <div className="rounded-lg border border-slate-800 p-3 bg-slate-900/40">
                            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                              Error Catalog — <code className="text-indigo-300">{it.errorEntry.code}</code>
                            </div>
                            <div className="text-xs text-slate-300">Applicable to: {it.errorEntry.applicableStudyTypes.join(', ')}</div>
                            {it.errorEntry.supportingReferenceIds.length > 0 && (
                              <div className="mt-1 text-xs text-sky-300">Refs: {it.errorEntry.supportingReferenceIds.join(', ')}</div>
                            )}
                          </div>
                        )}
                        {it.resolutionNotes && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                            <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1">Resolution Notes — {it.resolvedBy} on {it.resolvedAt && new Date(it.resolvedAt).toLocaleString()}</div>
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{it.resolutionNotes}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        {it.status !== 'resolved' && (
                          <button onClick={() => setResolving({ id: it.id, notes: it.resolutionNotes ?? '', status: 'resolved' })} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                            <CheckCircle2 className="h-4 w-4" /> Mark Resolved
                          </button>
                        )}
                        <button onClick={() => changeStatus(it.id, 'pending')} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20">
                          <AlertCircle className="h-4 w-4" /> Flag as Pending
                        </button>
                        <button onClick={() => changeStatus(it.id, 'open')} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/20">
                          <AlertTriangle className="h-4 w-4" /> Re-open
                        </button>
                        <button onClick={() => changeStatus(it.id, 'dismissed', 'Dismissed — not applicable per scope review.')} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                          <XCircle className="h-4 w-4" /> Dismiss (not valid)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {showAdd && (
          <AddIssueModal
            studyId={studyId}
            onClose={() => setShowAdd(false)}
            onSave={(item) => {
              setItems((current) => [item, ...current]);
              setShowAdd(false);
            }}
          />
        )}

        {resolving && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
                <h2 className="font-semibold text-slate-100">Mark as Resolved</h2>
                <button onClick={() => setResolving(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X className="h-4 w-4" /></button>
              </div>
              <div className="px-5 py-4 grid gap-3">
                <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Resolution notes (required for audit)</label>
                <textarea
                  value={resolving.notes}
                  onChange={e => setResolving({ ...resolving, notes: e.target.value })}
                  rows={4}
                  placeholder="Describe the corrective action applied, relevant pages/sections, and who approved the change."
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
                <button onClick={() => setResolving(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
                <button
                  onClick={() => changeStatus(resolving.id, resolving.status, resolving.notes || 'No notes provided.')}
                  disabled={!resolving.notes.trim()}
                  className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >Confirm Resolution</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ResearchWorkspaceShell>
  );
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: SeverityLevel; icon: React.ReactNode }) {
  const s = SEVERITY_STYLES[color];
  return (
    <div className={`rounded-xl border p-4 ${s.bg} ${s.ring}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">{label}</span>
        <span className={s.text}>{icon}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold ${s.text}`}>{value}</div>
    </div>
  );
}

function AddIssueModal({ studyId, onClose, onSave }: { studyId: string; onClose: () => void; onSave: (item: ValidationItem) => void }) {
  const [form, setForm] = useState({
    title: '',
    severity: 'moderate' as SeverityLevel,
    category: 'methodological' as ErrorCategory,
    detail: '',
    suggestedAction: '',
    fieldLabel: '',
    section: '',
    useCatalog: '' as string,
  });

  const save = () => {
    const base: ValidationItem = {
      id: crypto.randomUUID(),
      studyId,
      status: 'open',
      title: form.title,
      severity: form.severity,
      category: form.category,
      detail: form.detail,
      suggestedAction: form.suggestedAction,
      location: { section: form.section, fieldLabel: form.fieldLabel },
      createdAt: new Date().toISOString(),
    };
    if (form.useCatalog) {
      const cat = ERROR_CATALOG.find(c => c.id === form.useCatalog);
      if (cat) {
        base.title = cat.shortMessage;
        base.severity = cat.severity as SeverityLevel;
        base.category = cat.category as ErrorCategory;
        base.detail = cat.detailedMessage;
        base.suggestedAction = cat.suggestedCorrection;
        base.errorEntry = cat;
      }
    }
    onSave(base);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="font-semibold text-slate-100">Report New Issue / Deficiency</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 grid gap-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Apply Pre-defined from Error Catalog</label>
            <select
              value={form.useCatalog}
              onChange={e => setForm({ ...form, useCatalog: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">(enter manually)</option>
              {ERROR_CATALOG.map(c => <option key={c.id} value={c.id}>[{c.code}] {c.shortMessage} — {c.severity}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Severity</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as SeverityLevel })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as ErrorCategory })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                <option value="methodological">Methodological</option>
                <option value="statistical">Statistical</option>
                <option value="clinical">Clinical</option>
                <option value="missing_data">Missing Data</option>
                <option value="regulatory">Regulatory</option>
                <option value="crf_structural">CRF Structural</option>
                <option value="reference_scope">Reference Scope</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Title</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Field Label</label>
              <input value={form.fieldLabel} onChange={e => setForm({ ...form, fieldLabel: e.target.value })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="optional" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Section / Page</label>
              <input value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="optional" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Detailed Description</label>
            <textarea value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} rows={3} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Suggested Correction / Action</label>
            <textarea value={form.suggestedAction} onChange={e => setForm({ ...form, suggestedAction: e.target.value })} rows={2} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={save} disabled={!form.title.trim() || !form.detail.trim()} className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50">Save Issue</button>
        </div>
      </div>
    </div>
  );
}
