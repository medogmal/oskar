import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  Link2,
  LoaderCircle,
  Search,
  Workflow,
} from 'lucide-react';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';
import { exportBibTeX, exportRIS } from '../lib/exportLib';
import { listStudyFiles, type StudyResourceFile } from '../lib/studyWorkspaceFiles';

type KnowledgeReference = {
  id: string;
  title: string;
  category: string;
  subcategory?: string;
  study_types: string[];
  description_en?: string;
  description_ar?: string;
};

type KnowledgeReferencesResponse = {
  studyType: string;
  referenceCount: number;
  references: KnowledgeReference[];
};

const STUDY_TYPES = [
  { value: 'rct', label: 'RCT' },
  { value: 'prospective', label: 'Prospective' },
  { value: 'retrospective', label: 'Retrospective' },
  { value: 'cross_sectional', label: 'Cross-Sectional' },
  { value: 'in_vitro', label: 'In Vitro' },
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const buildScholarUrl = (reference: KnowledgeReference) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(reference.title)}`;

const buildCsv = (references: KnowledgeReference[]) =>
  '\uFEFFID,Title,Category,Subcategory,Study Types,Description EN,Description AR\n' +
  references
    .map((reference) =>
      [
        reference.id,
        reference.title,
        reference.category,
        reference.subcategory ?? '',
        reference.study_types.join('; '),
        reference.description_en ?? '',
        reference.description_ar ?? '',
      ]
        .map((value) => {
          const text = String(value).replace(/"/g, '""');
          return /[",\n]/.test(text) ? `"${text}"` : text;
        })
        .join(','),
    )
    .join('\n');

const triggerCsvDownload = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
};

export default function KnowledgeReferences() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get('studyId') ?? '';
  const [studyType, setStudyType] = useState(searchParams.get('studyType') || 'rct');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [references, setReferences] = useState<KnowledgeReference[]>([]);
  const [studyFiles, setStudyFiles] = useState<StudyResourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('');

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError('');

        const [referencesResponse, files] = await Promise.all([
          fetch(`${apiBaseUrl}/analytics/knowledge/references/${encodeURIComponent(studyType)}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          studyId ? listStudyFiles(studyId, token) : Promise.resolve([]),
        ]);

        if (!referencesResponse.ok) {
          throw new Error('Unable to load knowledge references');
        }

        const payload = (await referencesResponse.json()) as KnowledgeReferencesResponse;
        if (cancelled) {
          return;
        }

        setReferences(payload.references ?? []);
        setStudyFiles(files);
      } catch {
        if (!cancelled) {
          setError('تعذر تحميل مكتبة المراجع الحالية.');
          setReferences([]);
          setStudyFiles([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId, studyType, token]);

  const categories = useMemo(
    () => Array.from(new Set(references.map((reference) => reference.category))).sort(),
    [references],
  );

  const filtered = useMemo(() => {
    let output = references;
    if (category) {
      output = output.filter((reference) => reference.category === category);
    }
    if (!search.trim()) {
      return output;
    }

    const query = search.toLowerCase();
    return output.filter((reference) =>
      [
        reference.id,
        reference.title,
        reference.category,
        reference.subcategory ?? '',
        reference.description_en ?? '',
        reference.description_ar ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [category, references, search]);

  const matchedFiles = (reference: KnowledgeReference) => {
    const refId = normalize(reference.id);
    const refTitle = normalize(reference.title);
    return studyFiles.filter((file) => {
      const fileName = normalize(file.originalName);
      return fileName.includes(refId) || (refTitle && fileName.includes(refTitle.slice(0, Math.min(refTitle.length, 18))));
    });
  };

  const addReferenceToMatrix = async (referenceId: string) => {
    if (!studyId) {
      await navigator.clipboard.writeText(referenceId);
      setCopyState(referenceId);
      return;
    }

    navigate(`/studies/${studyId}/variable-matrix?reference=${encodeURIComponent(referenceId)}`);
  };

  const exportableRefs = filtered.map((reference) => ({
    id: reference.id,
    title: reference.title,
    authors: reference.subcategory ?? reference.category,
    year: '',
    journal: reference.category,
    volume: '',
    pages: '',
  }));

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav(studyId || undefined)}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-6 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BookOpen className="h-6 w-6 text-violet-300" />
              <div>
                <h1 className="text-xl font-bold">Knowledge Base Reference Library</h1>
                <p className="text-xs text-slate-400">
                  {loading ? 'Loading references...' : `${filtered.length} / ${references.length} reference(s) visible`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => triggerCsvDownload(buildCsv(filtered), `knowledge-references-${studyType}.csv`)}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"
              >
                <FileDown className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button
                onClick={() => exportBibTeX(exportableRefs, `knowledge-references-${studyType}`)}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20"
              >
                <Download className="h-3.5 w-3.5" /> BibTeX
              </button>
              <button
                onClick={() => exportRIS(exportableRefs, `knowledge-references-${studyType}`)}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20"
              >
                <Download className="h-3.5 w-3.5" /> RIS
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-6 py-5">
          {error ? <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title, id, category, or description..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900/50 pl-8 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <select
              value={studyType}
              onChange={(event) => setStudyType(event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {STUDY_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All categories</option>
              {categories.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          {studyId ? (
            <div className="mb-5 rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-200">
              الصفحة مرتبطة بالدراسة الحالية. يمكن استخدام زر `Add to CRF / Matrix` لإرسال المرجع مباشرة إلى `Variable Matrix`.
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading knowledge references...
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">
                  No matching references. Try another study type or clear filters.
                </div>
              ) : null}

              {filtered.map((reference) => {
                const isOpen = expandedId === reference.id;
                const linkedFiles = matchedFiles(reference);
                return (
                  <div
                    key={reference.id}
                    className={`rounded-2xl border transition ${isOpen ? 'border-violet-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}
                  >
                    <button
                      onClick={() => setExpandedId(isOpen ? null : reference.id)}
                      className="flex w-full items-start gap-4 p-5 text-left"
                    >
                      <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-300 ring-1 ring-violet-500/20">
                        <BookMarked className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">{reference.id}</span>
                          <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">{reference.category}</span>
                          {reference.study_types.map((type) => (
                            <span key={type} className="rounded-md bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
                              {type}
                            </span>
                          ))}
                        </div>
                        <h2 className="font-semibold text-slate-100">{reference.title}</h2>
                        <p className="mt-1 text-xs text-slate-400">
                          {reference.description_en || reference.description_ar || 'No description available.'}
                        </p>
                      </div>
                    </button>

                    {isOpen ? (
                      <div className="grid gap-5 border-t border-slate-800 px-5 py-4 md:grid-cols-2">
                        <div className="space-y-3">
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">English Description</div>
                            <p className="text-sm text-slate-200">{reference.description_en || 'No English description available.'}</p>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Arabic Description</div>
                            <p className="text-sm text-slate-200" dir="rtl">
                              {reference.description_ar || 'لا يوجد وصف عربي متاح.'}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Reference Actions</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void addReferenceToMatrix(reference.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-500/20"
                              >
                                <Workflow className="h-3.5 w-3.5" />
                                {studyId ? 'Add to CRF / Matrix' : copyState === reference.id ? 'Copied ID' : 'Copy Reference ID'}
                              </button>
                              <button
                                onClick={() => window.open(buildScholarUrl(reference), '_blank', 'noopener,noreferrer')}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open Source Search
                              </button>
                              <button
                                onClick={() => navigator.clipboard.writeText(`[${reference.id}] ${reference.title}`)}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Copy Citation
                              </button>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Study-linked Source Files</div>
                            {linkedFiles.length === 0 ? (
                              <p className="text-xs text-slate-400">
                                لا يوجد ملف مرفوع داخل الدراسة الحالية يطابق هذا المرجع. يمكنك رفع ملف المرجع من تبويب ملفات الدراسة ثم سيظهر هنا تلقائيًا.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {linkedFiles.map((file) => (
                                  <button
                                    key={file.id}
                                    onClick={() => window.open(`${apiBaseUrl}/studies/${studyId}/files/${file.id}/download`, '_blank', 'noopener,noreferrer')}
                                    className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                                  >
                                    <span className="truncate">{file.originalName}</span>
                                    <span className="inline-flex items-center gap-1 text-sky-300">
                                      <Link2 className="h-3.5 w-3.5" /> Open
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {studyId ? (
                            <button
                              onClick={() => navigate(`/studies/${studyId}?tab=files`)}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-300 hover:bg-sky-500/20"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5" />
                              Open Study Files
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ResearchWorkspaceShell>
  );
}
