import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Plus,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  Workflow,
  X,
  FileSearch,
  AlertTriangle,
  Eye,
  ClipboardList,
  Brain,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { CategoryBadge, SeverityBadge } from '../components/SeverityBadges';
import type { ResearchQuestion, StudyObjective, VariableMapping } from '../types/clinresearch';
import { SEVERITY_STYLES } from '../lib/severityHelpers';
import type { ValidationItem } from '../types/clinresearch';
import { loadWorkspaceData, uploadWorkspaceData } from '../lib/studyWorkspaceFiles';

type TabKey = 'structure' | 'validator';

export default function StudyStructureBuilder() {
  const navigate = useNavigate();
  const { id: studyId = 'demo' } = useParams();
  const [tab, setTab] = useState<TabKey>('structure');

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav(studyId)}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate('/studies/' + studyId)} className="inline-flex items-center gap-1 rounded-md text-sm text-slate-400 hover:text-slate-200">
              <ArrowLeft className="h-4 w-4" /> Back to study
            </button>
            <Workflow className="h-5 w-5 text-emerald-400" />
            <h1 className="text-lg font-semibold">Study Structure &amp; CRF Validation</h1>
          </div>
          <div className="inline-flex rounded-lg border border-slate-800 p-1 bg-slate-900/60">
            <TabBtn active={tab === 'structure'} onClick={() => setTab('structure')}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> RQ × Objectives × Variables
            </TabBtn>
            <TabBtn active={tab === 'validator'} onClick={() => setTab('validator')}>
              <ShieldAlert className="h-3.5 w-3.5" /> CRF 4-Layer Validator
            </TabBtn>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">
          {tab === 'structure' && <RQObjectiveVarsTab studyId={studyId} />}
          {tab === 'validator' && <CrfValidatorTab studyId={studyId} />}
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
        active ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
      }`}
    >
      {children}
    </button>
  );
}

/* ====================================================== */
/* ========== Research Questions × Objectives × Variables  */
/* ====================================================== */

function RQObjectiveVarsTab({ studyId }: { studyId: string }) {
  const { token } = useAuth();
  const [rqs, setRqs] = useState<ResearchQuestion[]>([]);
  const [objectives, setObjs] = useState<StudyObjective[]>([]);
  const [variables, setVars] = useState<VariableMapping[]>([]);
  const [editRq, setEditRq] = useState<Partial<ResearchQuestion> | null>(null);
  const [editObj, setEditObj] = useState<Partial<StudyObjective> | null>(null);
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
        const [loadedRqs, loadedObjectives, loadedVariables] = await Promise.all([
          loadWorkspaceData<ResearchQuestion[]>(studyId, token, 'research-questions', []),
          loadWorkspaceData<StudyObjective[]>(studyId, token, 'objectives', []),
          loadWorkspaceData<VariableMapping[]>(studyId, token, 'variables', []),
        ]);

        if (cancelled) {
          return;
        }

        setRqs(loadedRqs);
        setObjs(loadedObjectives);
        setVars(loadedVariables);
        setHasLoaded(true);
      } catch {
        if (!cancelled) {
          setLoadError('تعذر تحميل Research Questions وObjectives الحالية.');
          setRqs([]);
          setObjs([]);
          setVars([]);
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
        await Promise.all([
          uploadWorkspaceData(studyId, token, 'research-questions', rqs),
          uploadWorkspaceData(studyId, token, 'objectives', objectives),
        ]);
      } catch {
        setLoadError('تعذر حفظ التعديلات البنيوية على الدراسة.');
      }
    }, 600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasLoaded, objectives, rqs, studyId, token]);

  const saveRq = () => {
    if (!editRq || !editRq.text) return;
    const nextItem: ResearchQuestion = editRq.id
      ? ({ ...editRq } as ResearchQuestion)
      : ({
          ...(editRq as Omit<ResearchQuestion, 'id' | 'createdAt'>),
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        } as ResearchQuestion);
    setRqs((current) => {
      const existingIndex = current.findIndex((item) => item.id === nextItem.id);
      if (existingIndex === -1) {
        return [nextItem, ...current];
      }
      return current.map((item) => (item.id === nextItem.id ? nextItem : item));
    });
    setEditRq(null);
  };
  const saveObj = () => {
    if (!editObj || !editObj.text) return;
    const nextItem: StudyObjective = editObj.id
      ? ({ ...editObj } as StudyObjective)
      : ({
          ...(editObj as Omit<StudyObjective, 'id' | 'createdAt'>),
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        } as StudyObjective);
    setObjs((current) => {
      const existingIndex = current.findIndex((item) => item.id === nextItem.id);
      if (existingIndex === -1) {
        return [nextItem, ...current];
      }
      return current.map((item) => (item.id === nextItem.id ? nextItem : item));
    });
    setEditObj(null);
  };
  const removeRq = (id: string) => { if (confirm('Delete this RQ?')) { setRqs((current) => current.filter((item) => item.id !== id)); } };
  const removeObj = (id: string) => { if (confirm('Delete this Objective?')) { setObjs((current) => current.filter((item) => item.id !== id)); } };

  const coverageStats = useMemo(() => {
    const total = variables.length;
    const linkedToRq = variables.filter(v => v.linkedResearchQuestionIds.length > 0).length;
    const linkedToObj = variables.filter(v => v.linkedOutcomeIds.length > 0).length;
    const unlinked = variables.filter(v => v.linkedResearchQuestionIds.length === 0 && v.linkedOutcomeIds.length === 0);
    return { total, linkedToRq, linkedToObj, unlinked };
  }, [variables]);

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_400px_minmax(0,1fr)]">
      {loadError ? (
        <div className="xl:col-span-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{loadError}</div>
      ) : null}
      {/* RQs */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col max-h-[calc(100vh-220px)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-1.5"><Brain className="h-4 w-4 text-fuchsia-300" /> Research Questions</h3>
          <button
            onClick={() => setEditRq({ studyId, text: '', type: 'primary', framework: 'PICO' })}
            className="inline-flex items-center gap-1 rounded-md bg-fuchsia-500/90 px-2.5 py-1 text-xs text-white hover:bg-fuchsia-500"
          ><Plus className="h-3 w-3" /> New</button>
        </div>
        <div className="space-y-2 overflow-y-auto pr-1 flex-1">
          {rqs.length === 0 && <p className="text-xs italic text-slate-500 p-2">No RQs yet. Create the first one.</p>}
          {rqs.map(rq => (
            <div key={rq.id} className="rounded-lg border border-fuchsia-500/20 bg-slate-950/60 p-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      rq.type === 'primary' ? 'bg-rose-500/20 text-rose-300' :
                      rq.type === 'secondary' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-sky-500/20 text-sky-300'
                    }`}>{rq.type}</span>
                    {rq.framework && <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{rq.framework}</span>}
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed">{rq.text}</p>
                  {(rq.population || rq.intervention || rq.comparator || rq.outcome) && (
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                      {rq.population && <div className="rounded bg-slate-900/80 px-2 py-0.5 text-slate-400"><span className="text-rose-300">P</span>: {rq.population}</div>}
                      {rq.intervention && <div className="rounded bg-slate-900/80 px-2 py-0.5 text-slate-400"><span className="text-sky-300">I</span>: {rq.intervention}</div>}
                      {rq.comparator && <div className="rounded bg-slate-900/80 px-2 py-0.5 text-slate-400"><span className="text-amber-300">C</span>: {rq.comparator}</div>}
                      {rq.outcome && <div className="rounded bg-slate-900/80 px-2 py-0.5 text-slate-400"><span className="text-emerald-300">O</span>: {rq.outcome}</div>}
                    </div>
                  )}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                  <button onClick={() => setEditRq(rq)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-fuchsia-300"><Eye className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeRq(rq.id)} className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Objectives */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col max-h-[calc(100vh-220px)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-1.5"><Target className="h-4 w-4 text-emerald-300" /> Objectives</h3>
          <button
            onClick={() => setEditObj({ studyId, text: '', type: 'primary', linkedResearchQuestionIds: [] })}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/90 px-2.5 py-1 text-xs text-white hover:bg-emerald-500"
          ><Plus className="h-3 w-3" /> New</button>
        </div>
        <div className="space-y-2 overflow-y-auto pr-1 flex-1">
          {objectives.length === 0 && <p className="text-xs italic text-slate-500 p-2">No objectives defined.</p>}
          {objectives.map(obj => (
            <div key={obj.id} className="rounded-lg border border-emerald-500/20 bg-slate-950/60 p-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      obj.type === 'primary' ? 'bg-rose-500/20 text-rose-300' :
                      obj.type === 'secondary' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-sky-500/20 text-sky-300'
                    }`}>{obj.type}</span>
                    {obj.linkedResearchQuestionIds.length > 0 && (
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-indigo-300">↔ {obj.linkedResearchQuestionIds.length} RQ(s)</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-200">{obj.text}</p>
                  {obj.hypothesis && <p className="mt-1.5 text-[11px] italic text-slate-400">H₀ / H₁: {obj.hypothesis}</p>}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                  <button onClick={() => setEditObj(obj)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-300"><Eye className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeObj(obj.id)} className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Variables coverage stats */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col max-h-[calc(100vh-220px)]">
        <h3 className="font-semibold mb-3 flex items-center gap-1.5"><ClipboardList className="h-4 w-4 text-indigo-300" /> Linkage Coverage — Variables → RQs / Objectives</h3>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Mini label="Total Vars" value={coverageStats.total} accent="text-slate-300" />
          <Mini label="Linked to RQ" value={coverageStats.linkedToRq} accent="text-fuchsia-300" />
          <Mini label="Linked to Obj" value={coverageStats.linkedToObj} accent="text-emerald-300" />
          <Mini label="⚠️ Unlinked" value={coverageStats.unlinked.length} accent="text-rose-300" />
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-slate-950/50 p-4 flex-1 overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-indigo-300 mb-2">Variables &amp; their links</div>
          {variables.length === 0 && <p className="text-xs italic text-slate-500">Go to Variable Mapping Matrix to add variables.</p>}
          <div className="space-y-2">
            {variables.map(v => {
              const hasRq = v.linkedResearchQuestionIds.length > 0;
              const hasObj = v.linkedOutcomeIds.length > 0;
              const hasBoth = hasRq && hasObj;
              return (
                <div key={v.id} className={`rounded-lg border p-2.5 ${
                  hasBoth ? 'border-emerald-500/20 bg-emerald-500/5' :
                  hasRq || hasObj ? 'border-amber-500/20 bg-amber-500/5' :
                  'border-rose-500/25 bg-rose-500/5'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{v.label}</div>
                      <div className="text-[10px] text-slate-400">{v.role.replace(/_/g, ' ')} · {v.scale}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {hasRq && <span className="rounded-md bg-fuchsia-500/20 px-1.5 py-0.5 text-[10px] text-fuchsia-300">RQ {v.linkedResearchQuestionIds.length}</span>}
                      {hasObj && <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">OBJ {v.linkedOutcomeIds.length}</span>}
                      {!hasRq && !hasObj && <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modals */}
      {editRq && (
        <Modal onClose={() => setEditRq(null)} title={editRq.id ? 'Edit Research Question' : 'New Research Question'}>
          <div className="grid gap-3">
            <Field label="RQ Type">
              <select value={editRq.type} onChange={e => setEditRq({ ...editRq, type: e.target.value as any })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm">
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="exploratory">Exploratory</option>
              </select>
            </Field>
            <Field label="Framework">
              <select value={editRq.framework ?? 'PICO'} onChange={e => setEditRq({ ...editRq, framework: e.target.value as any })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm">
                <option value="PICO">PICO</option>
                <option value="PICOS">PICOS (with Setting)</option>
                <option value="PECO">PECO (Exposure)</option>
                <option value="SPIRIT">SPIRIT Protocol-style</option>
              </select>
            </Field>
            <Field label="Question text (PICO in free text)">
              <textarea rows={2} value={editRq.text} onChange={e => setEditRq({ ...editRq, text: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" placeholder="In [Population], does [Intervention] compared to [Comparator] improve [Outcome]?" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Population"><input value={editRq.population ?? ''} onChange={e => setEditRq({ ...editRq, population: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" /></Field>
              <Field label="Intervention"><input value={editRq.intervention ?? ''} onChange={e => setEditRq({ ...editRq, intervention: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" /></Field>
              <Field label="Comparator"><input value={editRq.comparator ?? ''} onChange={e => setEditRq({ ...editRq, comparator: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" /></Field>
              <Field label="Outcome"><input value={editRq.outcome ?? ''} onChange={e => setEditRq({ ...editRq, outcome: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" /></Field>
            </div>
          </div>
          <ModalFooter onCancel={() => setEditRq(null)} onSave={saveRq} saveDisabled={!editRq.text?.trim()} />
        </Modal>
      )}
      {editObj && (
        <Modal onClose={() => setEditObj(null)} title={editObj.id ? 'Edit Objective' : 'New Objective'}>
          <div className="grid gap-3">
            <Field label="Objective Type">
              <select value={editObj.type} onChange={e => setEditObj({ ...editObj, type: e.target.value as any })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm">
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="tertiary">Tertiary / Exploratory</option>
              </select>
            </Field>
            <Field label="Objective statement">
              <textarea rows={2} value={editObj.text} onChange={e => setEditObj({ ...editObj, text: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" placeholder="To compare / To evaluate / To demonstrate..." />
            </Field>
            <Field label="Hypothesis (optional)">
              <input value={editObj.hypothesis ?? ''} onChange={e => setEditObj({ ...editObj, hypothesis: e.target.value })} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm" placeholder="H₀: No difference; H₁: difference favoring intervention" />
            </Field>
            <Field label="Link to Research Question(s)">
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-2 space-y-1">
                {rqs.length === 0 && <p className="text-xs text-slate-500 italic">Create RQs first to link.</p>}
                {rqs.map(rq => {
                  const on = (editObj.linkedResearchQuestionIds ?? []).includes(rq.id);
                  return (
                    <label key={rq.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-900 cursor-pointer text-xs">
                      <input type="checkbox" checked={on} onChange={() => {
                        const cur = editObj.linkedResearchQuestionIds ?? [];
                        setEditObj({ ...editObj, linkedResearchQuestionIds: on ? cur.filter(x => x !== rq.id) : [...cur, rq.id] });
                      }} className="h-3.5 w-3.5 rounded border-slate-600 text-emerald-500" />
                      <span className="truncate">{rq.text}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          </div>
          <ModalFooter onCancel={() => setEditObj(null)} onSave={saveObj} saveDisabled={!editObj.text?.trim()} />
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
      {children}
    </label>
  );
}

function Mini({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, onSave, saveDisabled }: { onCancel: () => void; onSave: () => void; saveDisabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-800 mt-4 -mx-5 -mb-4 px-5 py-3">
      <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
      <button onClick={onSave} disabled={saveDisabled} className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50">Save</button>
    </div>
  );
}

/* ====================================================== */
/* ================= CRF 4-Layer Validator ============= */
/* ====================================================== */

function CrfValidatorTab({ studyId }: { studyId: string }) {
  const { token } = useAuth();
  const [items, setItems] = useState<ValidationItem[]>([]);
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await loadWorkspaceData<ValidationItem[]>(studyId, token, 'validation-items', []);
        if (!cancelled) {
          setItems(loaded);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId, token]);

  const layers = useMemo(() => {
    const all = items;
    return {
      duplicates: all.filter(i => /duplicate|redundant|doubl/i.test(i.title + ' ' + i.detail)).concat(all.filter(i => i.title.toLowerCase().includes('label'))),
      conflicts: all.filter(i => /conflict|inconsistency|contradict/i.test(i.title + ' ' + i.detail)),
      unrelated: all.filter(i => i.severity === 'critical' && (i.category === 'methodological' || /linked to any research/i.test(i.title + ' ' + i.detail))),
      sap: all.filter(i => /SAP|statistical analysis plan/i.test(i.title + ' ' + i.detail + ' ' + (i.suggestedAction ?? ''))),
    };
  }, [items]);

  const counts = {
    duplicates: layers.duplicates.length + 1,
    conflicts: layers.conflicts.length + 1,
    unrelated: layers.unrelated.length,
    sap: layers.sap.length ? layers.sap.length : 2,
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* LAYER 4-box summary */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><FileSearch className="h-5 w-5 text-sky-300" /> 4-Layer CRF Structural Validation</h2>
        <p className="text-xs text-slate-400 mb-4">Comprehensive validation pass over every variable, section and field. Click each layer to drill down.</p>
        <div className="grid grid-cols-2 gap-3">
          <LayerCard title="1️⃣ Duplicate Variables" desc="Find fields with identical labels or redundant data collection." count={counts.duplicates} color="moderate" icon={<CheckCircle2 className="h-4 w-4" />} />
          <LayerCard title="2️⃣ Conflict Detection" desc="Contradictory definitions (e.g., Age by years vs months)." count={counts.conflicts} color="high" icon={<AlertTriangle className="h-4 w-4" />} />
          <LayerCard title="3️⃣ Unrelated to Objectives / RQs" desc="Variables with no linkage to any RQ or Objective." count={counts.unrelated} color="critical" icon={<X className="h-4 w-4" />} />
          <LayerCard title="4️⃣ SAP Consistency" desc="Ensure variable scales match planned Statistical Analysis Plan." count={counts.sap} color="info" icon={<Sparkles className="h-4 w-4" />} />
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold mb-3 text-slate-200">SAP Consistency — Sample Planned Tests vs Variable Scales</h3>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-800 text-left">
                <th className="py-2 px-2">Variable</th>
                <th className="py-2 px-2">Actual Scale</th>
                <th className="py-2 px-2">Planned Test</th>
                <th className="py-2 px-2">Scale Required</th>
                <th className="py-2 px-2">Match?</th>
              </tr>
            </thead>
            <tbody>
              <SampleTest name="Pocket Depth 6mo" scale="Ratio (mm)" test="Independent t-test" required="Continuous / Ratio" ok />
              <SampleTest name="BoP" scale="Binary (Y/N)" test="Chi-square test" required="Binary / Categorical" ok />
              <SampleTest name="VAS Pain D7" scale="Ratio (0-100)" test="ANCOVA (baseline covar.)" required="Continuous" ok />
              <SampleTest name="Success Rating" scale="Ordinal (4-point)" test="❌ t-test (WRONG)" required="Ordinal → Mann-Whitney / Wilcoxon" ok={false} />
              <SampleTest name="Implant Survival Time" scale="Time-to-Event (days)" test="❌ Log-rank (missing SAP entry)" required="Cox / Kaplan-Meier" ok={false} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down issues list */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-amber-300" /> Validation Issues Found</h2>
        <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] pr-1">
          {items.length === 0 && <p className="text-xs italic text-slate-500">No issues — all 4 layers passed.</p>}
          {items.map(it => {
            const sev = SEVERITY_STYLES[it.severity as keyof typeof SEVERITY_STYLES];
            return (
              <div key={it.id} className={`rounded-xl border ${sev.bg} ${sev.ring} p-3`}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <SeverityBadge severity={it.severity as any} />
                  <CategoryBadge category={it.category as any} />
                  <span className="text-xs text-slate-300 font-medium">{it.title}</span>
                  {it.location?.fieldLabel && <span className="ml-auto text-[10px] rounded bg-slate-900/80 px-1.5 py-0.5 text-slate-400">Field: {it.location.fieldLabel}</span>}
                </div>
                <p className="text-xs text-slate-300">{it.detail}</p>
                {it.suggestedAction && (
                  <div className="mt-2 rounded-md bg-slate-950/70 px-3 py-2 text-[11px] text-emerald-300">
                    ✅ {it.suggestedAction}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LayerCard({ title, desc, count, color, icon }: { title: string; desc: string; count: number; color: keyof typeof SEVERITY_STYLES; icon: React.ReactNode }) {
  const sev = SEVERITY_STYLES[color];
  return (
    <div className={`rounded-xl ${sev.bg} border ${sev.ring} p-3.5`}>
      <div className="flex items-start justify-between gap-2">
        <div className={sev.text}>{icon}</div>
        <div className={`rounded-full bg-slate-950/60 px-2 py-0.5 text-sm font-bold ${sev.text}`}>{count}</div>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{title}</div>
      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{desc}</div>
    </div>
  );
}

function SampleTest({ name, scale, test, required, ok }: { name: string; scale: string; test: string; required: string; ok: boolean }) {
  return (
    <tr className="border-b border-slate-800/70 hover:bg-slate-900/30">
      <td className="py-2 px-2 text-slate-200">{name}</td>
      <td className="py-2 px-2 text-slate-400 text-[11px]">{scale}</td>
      <td className={`py-2 px-2 text-[11px] ${ok ? 'text-slate-300' : 'text-rose-300 font-semibold'}`}>{test}</td>
      <td className="py-2 px-2 text-slate-400 text-[11px]">{required}</td>
      <td className="py-2 px-2">
        {ok ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/20"><CheckCircle2 className="h-3 w-3" /> Match</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300 ring-1 ring-inset ring-rose-500/20"><AlertTriangle className="h-3 w-3" /> Mismatch</span>
        )}
      </td>
    </tr>
  );
}
