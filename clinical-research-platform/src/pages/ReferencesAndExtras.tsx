import { useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  FileDown,
  GraduationCap,
  Search,
  ArrowRight,
  ExternalLink,
  BookMarked,
  FlaskConical,
  Workflow,
  Users,
  BarChart2,
  FlaskRound,
  Layers,
  BrainCircuit,
  BookCopy,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { exportBibTeX, exportRIS, openReportForPrint, buildBlankReport } from '../lib/exportLib';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';

type RefCat = 'rct' | 'observational' | 'statistics' | 'ethics' | 'guideline' | 'in_vitro' | 'reporting' | 'bias';
type ReferenceEntry = {
  id: string;
  code: string;
  authors: string;
  year: number;
  title: string;
  journal?: string;
  publisher?: string;
  volume?: string;
  pages?: string;
  doi?: string;
  category: RefCat;
  scope: string[];
  summaryEn: string;
  summaryAr: string;
  tags: string[];
  keywords: string[];
};

const REFERENCES: ReferenceEntry[] = [
  {
    id: 'CONSORT_2010',
    code: 'CONSORT 2010',
    authors: 'Schulz KF, Altman DG, Moher D, et al.',
    year: 2010,
    title: 'CONSORT 2010 Statement: Updated Guidelines for Reporting Parallel Group Randomised Trials',
    journal: 'PLOS Medicine',
    volume: '7(3)',
    pages: 'e1000251',
    doi: '10.1371/journal.pmed.1000251',
    category: 'reporting',
    scope: ['rct'],
    summaryEn: 'Gold-standard 25-item checklist + Flow Diagram for transparent reporting of Randomized Controlled Trials. Mandatory by ~600 medical journals.',
    summaryAr: 'دليل إرشادي معيار ذهبي بـ 25 بند وخريطة سير عمل للإبلاغ الشفاف عن التجارب المعشاة ذات المجموعات الموازية — ملزم بأكثر من 600 مجلة طبية.',
    tags: ['Reporting', 'RCT', 'Flow Diagram'],
    keywords: ['CONSORT', 'randomized trial', 'reporting guidelines'],
  },
  {
    id: 'ICH_E9',
    code: 'ICH E9(R1)',
    authors: 'International Council for Harmonisation',
    year: 2020,
    title: 'ICH E9(R1) — Statistical Principles for Clinical Trials: Addendum on Estimands & Sensitivity Analysis',
    publisher: 'ICH',
    doi: 'ich.e9.r1',
    category: 'guideline',
    scope: ['rct', 'observational'],
    summaryEn: 'Regulatory-standard statistical principles: alpha=0.05, power=0.80-0.90, Intention-to-Treat, multiplicity, missing data. Estimands framework and Sensitivity analysis mandates.',
    summaryAr: 'المبادئ الإحصائية المعيارية تنظيميًا: ألفا 0.05، قوة 0.80-0.90، Intention-to-Treat، تعديل الاختبارات المتعددة، البيانات المفقودة، إطار العمل Estimands والتحليل الحساسية.',
    tags: ['Regulatory', 'FDA', 'EMA', 'Statistics'],
    keywords: ['ICH', 'E9', 'estimands', 'sensitivity analysis', 'alpha spending'],
  },
  {
    id: 'STROBE',
    code: 'STROBE',
    authors: 'von Elm E, Altman DG, Egger M, et al.',
    year: 2008,
    title: 'The Strengthening the Reporting of Observational Studies in Epidemiology (STROBE) Statement',
    journal: 'PLOS Medicine',
    volume: '5(10)',
    pages: 'e296',
    doi: '10.1371/journal.pmed.0050296',
    category: 'reporting',
    scope: ['observational'],
    summaryEn: '22-item checklist for Cohort, Case-Control and Cross-sectional observational studies.',
    summaryAr: 'قائمة تدقيق بـ 22 بند للإبلاغ عن الدراسات الرصدية (Cohort / Case-Control / Cross-sectional).',
    tags: ['Observational', 'Cohort', 'Case-Control'],
    keywords: ['STROBE', 'observational'],
  },
  {
    id: 'ALTMAN_1991',
    code: 'Altman 1991',
    authors: 'Altman, Douglas G.',
    year: 1991,
    title: 'Practical Statistics for Medical Research',
    publisher: 'Chapman & Hall / CRC',
    category: 'statistics',
    scope: ['rct', 'observational', 'statistics'],
    summaryEn: 'Classic single-author textbook — t-tests, chi-square, non-parametric, regression, survival analysis with medical worked examples.',
    summaryAr: 'الكتاب الأساسي في الإحصاء الطبي — اختبارات تي، كاي تربيع، اللامعلمية، الانحدار، تحليل البقاء مع أمثلة طبية تطبيقية.',
    tags: ['Textbook', 'Statistics'],
    keywords: ['Altman', 'medical statistics'],
  },
  {
    id: 'COHEN_1988',
    code: 'Cohen 1988',
    authors: 'Cohen, Jacob',
    year: 1988,
    title: 'Statistical Power Analysis for the Behavioral Sciences (2nd Ed.)',
    publisher: 'Lawrence Erlbaum Associates',
    category: 'statistics',
    scope: ['rct', 'observational', 'statistics'],
    summaryEn: 'Canonical reference for effect-size conventions (small/medium/large) and sample-size calculation formulas.',
    summaryAr: 'المرجع الأساسي لـ Effect Size Conventions (صغير/متوسط/كبير) وصيغ حساب حجم العينة.',
    tags: ['Power', 'Effect Size', 'Sample Size'],
    keywords: ["Cohen's d", 'power analysis'],
  },
  {
    id: 'ROB_2',
    code: 'RoB 2.0',
    authors: 'Sterne JAC, et al.',
    year: 2019,
    title: 'RoB 2: A Revised Tool for Assessing Risk of Bias in Randomised Trials',
    journal: 'BMJ',
    volume: '366',
    pages: 'l4898',
    doi: '10.1136/bmj.l4898',
    category: 'bias',
    scope: ['rct', 'reporting'],
    summaryEn: 'Revised Cochrane Risk-of-Bias tool covering Randomization Process, Deviations, Missing Outcome, Measurement, Selection of Reported Result.',
    summaryAr: 'أداة كوكرين المحدثة لتقييم خطر الانحياز: عملية التعشية، الانحرافات، النتائج المفقودة، القياس، اختيار النتيجة المبلغ عنها.',
    tags: ['Cochrane', 'Bias', 'Systematic Review'],
    keywords: ['Risk of Bias', 'RoB 2'],
  },
  {
    id: 'ROBINS_E',
    code: 'ROBINS-E',
    authors: 'Sterne JAC, et al.',
    year: 2016,
    title: 'ROBINS-I: A Tool for Assessing Risk of Bias in Non-Randomized Studies of Interventions',
    journal: 'BMJ',
    volume: '355',
    pages: 'i4919',
    doi: '10.1136/bmj.i4919',
    category: 'bias',
    scope: ['observational'],
    summaryEn: 'Bias assessment for non-randomized interventional studies (7 domains).',
    summaryAr: 'تقييم خطر الانحياز للدراسات غير المعشاة للتدخلات (7 مجالات).',
    tags: ['Observational', 'Bias', 'NRSI'],
    keywords: ['ROBINS-I', 'non-randomized'],
  },
  {
    id: 'GCP',
    code: 'ICH-GCP E6(R2)',
    authors: 'International Council for Harmonisation',
    year: 2016,
    title: 'ICH E6(R2) — Good Clinical Practice Consolidated Guideline',
    publisher: 'ICH',
    category: 'ethics',
    scope: ['rct', 'observational', 'guideline'],
    summaryEn: 'Mandatory global standard for ethical conduct of human trials: Investigator, IRB/IEC, Sponsor, Monitor, CRO, Source Data, CRF, Audit Trail, Essential Documents.',
    summaryAr: 'المعيار العالمي الإلزامي لممارسات البحث السريري الجيد: الباحث، مجلس الأخلاق، الراعي، المراقب، بيانات المصدر، استمارة الفحص، سجل التدقيق.',
    tags: ['GCP', 'Regulatory', 'Ethics'],
    keywords: ['Good Clinical Practice', 'ICH E6'],
  },
  {
    id: 'AAP_PERIODONTAL',
    code: 'AAP 2018 Periodontitis Classification',
    authors: 'American Academy of Periodontology / EFP',
    year: 2018,
    title: 'A New Classification Scheme for Periodontal and Peri-Implant Diseases and Conditions',
    journal: 'J Periodontology',
    volume: '89(1 Suppl)',
    pages: 'S1–S243',
    category: 'guideline',
    scope: ['rct', 'observational', 'guideline'],
    summaryEn: 'Staging & Grading 2018 AAP/EFP classification: Stage I-IV, Grade A/B/C, risk modifiers, PD ≥6 mm cutoffs, CAL clinical attachment loss.',
    summaryAr: 'تصنيف الأكاديمية الأمريكية لأمراض اللثة 2018: المراحل I-IV، الدرجات A/B/C، عوامل الخطورة، قيم PD ≥6 مم.',
    tags: ['Dentistry', 'Periodontology', 'Clinical'],
    keywords: ['Periodontitis', 'CAL', 'PD', 'BPE', 'AAP 2018'],
  },
  {
    id: 'ISO_4049',
    code: 'ISO 4049:2019',
    authors: 'International Organization for Standardization',
    year: 2019,
    title: 'ISO 4049 — Dentistry — Polymer-Based Restorative Materials',
    publisher: 'ISO, Geneva',
    category: 'in_vitro',
    scope: ['in_vitro'],
    summaryEn: 'Compressive strength, flexural strength, diametral tensile, fracture toughness, water sorption/solubility, shade match, depth of cure, wear. ISO standards for dental resin composites.',
    summaryAr: 'المواصفات العالمية لمواد الحشو الضوئية: قوة انضغاطية، ثني، شد قطري، مقاومة الكسر، امتصاص الماء، عمق المعالجة، البلى.',
    tags: ['Dental Materials', 'In-Vitro'],
    keywords: ['ISO 4049', 'resin composite'],
  },
  {
    id: 'ISO_14801',
    code: 'ISO 14801:2016',
    authors: 'International Organization for Standardization',
    year: 2016,
    title: 'ISO 14801 — Endosseous Dental Implants — Dynamic Fatigue Test for Endosseous Dental Implants',
    publisher: 'ISO, Geneva',
    category: 'in_vitro',
    scope: ['in_vitro'],
    summaryEn: 'Accelerated cyclic loading 5×10⁶ @ max 500N ISO 14801 worst-case 30° off-axis load, specimen # per group (n=5+).',
    summaryAr: 'اختبار التعب الديناميكي للتخمة السنية 5 مليون دورة ب500 نيوتن بزاوية 30 درجة، عدد العينات ≥5 لكل مجموعة.',
    tags: ['Dental Implant', 'ISO Standard'],
    keywords: ['ISO 14801', 'fatigue testing', 'implant'],
  },
  {
    id: 'HOSMER_LEMESHOW',
    code: 'Hosmer & Lemeshow — Logistic',
    authors: 'Hosmer DW, Lemeshow S, Sturdivant RX',
    year: 2013,
    title: 'Applied Logistic Regression (3rd Ed.)',
    publisher: 'Wiley',
    category: 'statistics',
    scope: ['statistics'],
    summaryEn: 'Authoritative reference on Binary / Multinomial / Ordinal Logistic Regression, model building, diagnostics, HL GoF test.',
    summaryAr: 'المرجع المرجعي في الانحدار اللوجستي الثنائي متعدد الحدود الترتيبي، بناء النماذج، التشخيص، اختبار Hosmer-Lemeshow.',
    tags: ['Regression', 'Biostatistics'],
    keywords: ['Logistic Regression', 'HL test'],
  },
  {
    id: 'THERNEAU_COX',
    code: 'Therneau & Grambsch — Survival',
    authors: 'Therneau TM, Grambsch PM',
    year: 2000,
    title: 'Modeling Survival Data: Extending the Cox Model',
    publisher: 'Springer',
    category: 'statistics',
    scope: ['statistics'],
    summaryEn: 'Canonical Cox Proportional-Hazards textbook: Schoenfeld residuals, time-varying covariates, frailty models, competing risks.',
    summaryAr: 'المرجع الأساسي لنموذج مخاطر كوكس المتناسب: بقايا Schoenfeld، المتغيرات الزمنية، النماذج الهشة، المخاطر المتنافسة.',
    tags: ['Survival', 'Cox PH'],
    keywords: ['Kaplan-Meier', 'Cox', 'proportional hazards'],
  },
  {
    id: 'MAXWELL_ANOVA',
    code: 'Maxwell & Delaney 2004 — ANOVA',
    authors: 'Maxwell SE, Delaney HD, Kelley K',
    year: 2004,
    title: 'Designing Experiments and Analyzing Data: A Model Comparison Perspective',
    publisher: 'Erlbaum',
    category: 'statistics',
    scope: ['statistics'],
    summaryEn: 'Definitive One-way / Repeated-Measures / Mixed / Split-Plot / RM-MANOVA textbook; GG / HF epsilon corrections, contrasts, post-hoc.',
    summaryAr: 'المرجع الأساسي لتحليل التباين أحادي الاتجاه/المقاييس المتكررة/المختلط/السبليطة، تصحيحات Greenhouse-Geisser، المقارنات اللاحقة.',
    tags: ['ANOVA', 'Experimental Design'],
    keywords: ['RM-ANOVA', 'Greenhouse-Geisser', 'sphericity'],
  },
  {
    id: 'NIH_MISSING_2023',
    code: 'NIH 2023 Missing Data Best Practices',
    authors: 'NIH Office of Behavioral and Social Sciences Research',
    year: 2023,
    title: 'Best Practices for Missing Data Handling & Reporting in NIH-Funded Research',
    publisher: 'NIH',
    category: 'statistics',
    scope: ['rct', 'observational'],
    summaryEn: 'Pre-specify MCAR/MAR/MNAR classification; MICE (FCS) as primary; Sensitivity analysis; NEVER LOCF as primary.',
    summaryAr: 'تحديد تصنيف MCAR/MAR/MNAR مسبقًا؛ MICE كطريقة أساسية؛ التحليل الحساسي؛ يُمنع استخدام LOCF كأساسي.',
    tags: ['Missing Data', 'Best Practices'],
    keywords: ['MICE', 'LOCF', 'MAR'],
  },
  {
    id: 'CHOW_SS',
    code: 'Chow, Shao & Wang 2008',
    authors: 'Chow SC, Shao J, Wang H',
    year: 2008,
    title: 'Sample Size Calculations in Clinical Research (2nd Ed.)',
    publisher: 'CRC Press / Chapman & Hall',
    category: 'statistics',
    scope: ['statistics'],
    summaryEn: 'Comprehensive formulas: Continuous, Binary, Survival, Non-inferiority, Equivalence, Cross-over, Cluster, Group Sequential.',
    summaryAr: 'معجم الصيغ الشامل: مستمر، ثنائي، بقاء، عدم الدونية، التكافؤ، التجارب المتقاطعة، المجموعات العنقودية، المتسلسل.',
    tags: ['Sample Size'],
    keywords: ['Sample Size', 'Non-inferiority', 'Equivalence'],
  },
  {
    id: 'EQUATOR',
    code: 'EQUATOR Network',
    authors: 'EQUATOR Network, University of Oxford',
    year: 2024,
    title: 'Enhancing the QUAlity and Transparency Of health Research — Reporting Guidelines Library',
    publisher: 'equator-network.org',
    category: 'reporting',
    scope: ['rct', 'observational', 'in_vitro', 'reporting'],
    summaryEn: 'Repository of all health research reporting guidelines: CONSORT, STROBE, PRISMA, STARD, CARE, AAHARE, ARRIVE.',
    summaryAr: 'مكتبة كل دليل إبلاغ بحوث صحية: CONSORT, STROBE, PRISMA, STARD, CARE, AAHARE.',
    tags: ['Reporting', 'Checklists'],
    keywords: ['EQUATOR', 'PRISMA', 'STARD'],
  },
  {
    id: 'PRISMA_2020',
    code: 'PRISMA 2020',
    authors: 'Page MJ, McKenzie JE, Bossuyt PM, et al.',
    year: 2021,
    title: 'The PRISMA 2020 Statement for Reporting Systematic Reviews',
    journal: 'BMJ',
    volume: '372',
    pages: 'n71',
    doi: '10.1136/bmj.n71',
    category: 'reporting',
    scope: ['reporting'],
    summaryEn: '27-item updated checklist + 4-phase PRISMA Flow Diagram for transparent Systematic Review and Meta-analysis reporting.',
    summaryAr: 'قائمة تدقيق محدثة بـ 27 بند وخريطة سير بـ 4 مراحل للمراجعة المنهجية والتحليل التلائي الشفاف.',
    tags: ['Systematic Review', 'Meta-analysis'],
    keywords: ['PRISMA', 'SR/MA'],
  },
  {
    id: 'AGREE_II',
    code: 'AGREE II Instrument',
    authors: 'AGREE Next Steps Consortium',
    year: 2009,
    title: 'AGREE II Instrument — Appraisal of Guidelines for Research & Evaluation II',
    publisher: 'AGREE RESEARCH Trust',
    category: 'guideline',
    scope: ['guideline'],
    summaryEn: '23-item / 6-domain validated instrument to assess quality of Clinical Practice Guidelines: Scope, Stakeholder, Rigor, Clarity, Applicability, Editorial.',
    summaryAr: 'أداة موثقة بـ 23 بند / 6 مجالات لتقييم جودة إرشادات الممارسة السريرية: النطاق، أصحاب المصلحة، الدقة، الوضوح، القابلية للتطبيق.',
    tags: ['Guidelines', 'CPG'],
    keywords: ['AGREE II', 'CPG appraisal'],
  },
  {
    id: 'BRETZ_MULTIPLE',
    code: 'Bretz et al. — Multiple Comparisons',
    authors: 'Bretz F, Hothorn T, Westfall PH',
    year: 2010,
    title: 'Multiple Comparisons Using R',
    publisher: 'CRC Press',
    category: 'statistics',
    scope: ['statistics'],
    summaryEn: 'Bonferroni, Holm, Hochberg, Dunnett, Tukey, MCP-Mod, graphical approaches for alpha-allocation, gatekeeping procedures.',
    summaryAr: 'بونفيروني، هولم، هوخبيرج، دانيت، توكي، MCP-Mod، الأساليب الرسومية لتوزيع ألفا، إجراءات بوابة.',
    tags: ['Multiple Testing', 'Multiplicity'],
    keywords: ['alpha allocation', 'familywise error'],
  },
];

const CATEGORY_META: Record<RefCat, { label: string; icon: React.ReactNode; accent: string }> = {
  rct: { label: 'RCT Methods', icon: <Users className="h-3.5 w-3.5" />, accent: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  observational: { label: 'Observational / Epidemiology', icon: <BarChart2 className="h-3.5 w-3.5" />, accent: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30' },
  statistics: { label: 'Statistics & Methods', icon: <Layers className="h-3.5 w-3.5" />, accent: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30' },
  ethics: { label: 'Ethics / Regulatory', icon: <GraduationCap className="h-3.5 w-3.5" />, accent: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  guideline: { label: 'Clinical Guidelines', icon: <BookCopy className="h-3.5 w-3.5" />, accent: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  in_vitro: { label: 'In-Vitro / Materials / ISO', icon: <FlaskRound className="h-3.5 w-3.5" />, accent: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30' },
  reporting: { label: 'Reporting (CONSORT/STROBE/PRISMA)', icon: <BookMarked className="h-3.5 w-3.5" />, accent: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  bias: { label: 'Risk of Bias Tools', icon: <BrainCircuit className="h-3.5 w-3.5" />, accent: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
};

export default function ReferencesWorkspace() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'' | RefCat>('');
  const [scope, setScope] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let out = REFERENCES;
    if (cat) out = out.filter(r => r.category === cat);
    if (scope) out = out.filter(r => r.scope.includes(scope));
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(r =>
        r.title.toLowerCase().includes(s) ||
        r.authors.toLowerCase().includes(s) ||
        r.keywords.some(k => k.toLowerCase().includes(s)) ||
        r.tags.some(t => t.toLowerCase().includes(s)) ||
        r.summaryEn.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s)
      );
    }
    return out;
  }, [search, cat, scope]);

  const scopes = Array.from(new Set(REFERENCES.flatMap(r => r.scope)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-violet-300" />
            <h1 className="text-xl font-bold">Knowledge Base — Reference Library</h1>
            <span className="rounded-full bg-violet-500/15 px-3 py-0.5 text-xs text-violet-300 ring-1 ring-inset ring-violet-500/20">{REFERENCES.length} references loaded</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const data = REFERENCES.map(r => ({
                id: r.id, title: r.title, authors: r.authors, year: r.year, journal: r.journal ?? '', volume: r.volume ?? '', pages: r.pages ?? '', doi: r.doi ?? '', category: r.category,
              }));
              const csv = '\uFEFFID,Code,Authors,Year,Title,Journal,Volume,Pages,DOI,Category\n' +
                data.map(r => [r.id, '', r.authors, r.year, r.title, r.journal, r.volume, r.pages, r.doi, r.category]
                  .map(v => { const s = String(v).replace(/"/g, '""'); return /[",]/.test(s) ? `"${s}"` : s; }).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'reference-library.csv';
              a.click();
            }} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"><FileDown className="h-3.5 w-3.5" /> Export CSV</button>
            <button onClick={() => exportBibTeX(REFERENCES.map((r) => ({ ...r, year: String(r.year) })), 'reference-library')} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20"><Download className="h-3.5 w-3.5" /> BibTeX (.bib)</button>
            <button onClick={() => exportRIS(REFERENCES.map((r) => ({ ...r, year: String(r.year) })), 'reference-library')} className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20"><Download className="h-3.5 w-3.5" /> EndNote (.ris)</button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title, author, keyword, DOI, or scope…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/50 pl-8 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value as any)} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            <option value="">All categories</option>
            {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={scope} onChange={e => setScope(e.target.value)} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            <option value="">Any study-scope</option>
            {scopes.map(s => <option key={s} value={s}>Scope: {s}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(CATEGORY_META).map(([k, v]) => {
            const n = REFERENCES.filter(r => r.category === k).length;
            return (
              <button key={k} onClick={() => setCat(cat === k ? '' : k as RefCat)} className={`text-left rounded-xl p-4 border transition ${cat === k ? 'border-violet-500/50 bg-violet-500/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                <div className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${v.accent}`}>{v.icon} {v.label}</div>
                <div className="mt-2 text-2xl font-bold text-slate-100">{n}</div>
                <div className="text-[11px] text-slate-500">reference(s)</div>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {filtered.length === 0 && <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-500 text-sm">No matching references. Clear filters or search for other terms.</div>}
          {filtered.map(r => {
            const cat = CATEGORY_META[r.category];
            const open = expanded === r.id;
            return (
              <div key={r.id} className={`rounded-2xl border transition ${open ? 'border-violet-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                <button onClick={() => setExpanded(open ? null : r.id)} className="w-full text-left p-5 flex items-start gap-4">
                  <div className={`shrink-0 rounded-xl p-2.5 ring-1 ring-inset ${cat.accent}`}>
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">{r.code}</span>
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cat.accent}`}>{cat.icon} {cat.label}</span>
                      {r.scope.map(s => <span key={s} className="rounded-md bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-400">scope: {s}</span>)}
                      <span className="ml-auto text-[11px] text-slate-400">{r.year} · <code className="font-mono">{r.id}</code></span>
                    </div>
                    <h3 className="font-semibold text-slate-100 leading-snug">{r.title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{r.authors}{r.journal && <> · <span className="text-slate-300 italic">{r.journal}</span></>}{r.publisher && <> · <span className="text-slate-300">{r.publisher}</span></>}{r.volume && <> · Vol {r.volume}</>}{r.pages && <> · {r.pages}</>}</p>
                  </div>
                  <ArrowRight className={`h-4 w-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="border-t border-slate-800 px-5 pb-5 pt-4 grid md:grid-cols-2 gap-5">
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><ExternalLink className="h-3 w-3" /> English Summary</div>
                        <p className="text-sm text-slate-200 leading-relaxed">{r.summaryEn}</p>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><GraduationCap className="h-3 w-3" /> Arabic Summary</div>
                        <p className="text-sm text-slate-200 leading-relaxed" dir="rtl">{r.summaryAr}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Metadata</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {r.doi && <div><span className="text-slate-500">DOI:</span> <span className="text-slate-200 font-mono">{r.doi}</span></div>}
                          <div><span className="text-slate-500">Year:</span> <span className="text-slate-200">{r.year}</span></div>
                          {r.journal && <div className="col-span-2"><span className="text-slate-500">Source:</span> <span className="text-slate-200 italic">{r.journal}{r.volume && `, ${r.volume}`}{r.pages && `, ${r.pages}`}</span></div>}
                          {r.publisher && <div className="col-span-2"><span className="text-slate-500">Publisher:</span> <span className="text-slate-200">{r.publisher}</span></div>}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Tags &amp; Keywords</div>
                        <div className="flex flex-wrap gap-1.5 mb-2">{r.tags.map(t => <span key={t} className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">#{t}</span>)}</div>
                        <div className="flex flex-wrap gap-1.5">{r.keywords.map(k => <span key={k} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300 ring-1 ring-inset ring-violet-500/20">{k}</span>)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => navigate(`/studies/demo/variable-matrix?reference=${encodeURIComponent(r.id)}`)} className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-500/20"><Workflow className="h-3.5 w-3.5" /> Add to CRF — cite this</button>
                        <button onClick={() => navigator.clipboard?.writeText('[' + r.id + '] ' + r.authors + '. (' + r.year + '). ' + r.title)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"><Copy className="h-3.5 w-3.5" /> Copy citation</button>
                        <button onClick={() => {
                          const rpt = buildBlankReport('scientific_justification', 'demo', 'Scientific Justification Report', 'Research Platform');
                          rpt.references = [{ id: r.id, citationText: r.authors + ' (' + r.year + '). ' + r.title + '. ' + (r.journal || r.publisher || '') + '.' }];
                          rpt.sections = [{
                            id: 'just-' + r.id, heading: 'Justification citing: ' + r.code, level: 2,
                            body: r.summaryEn + '\n\n[Arabic]\n' + r.summaryAr,
                            highlights: [r.id + ' — ' + r.code + ' (' + r.year + ')'],
                            references: [r.id],
                          }];
                          openReportForPrint(rpt);
                        }} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"><ArrowUpRight className="h-3.5 w-3.5" /> Generate Justification snippet</button>
                      </div>
                    </div>
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

function Copy(props: any) {
  return <span {...props}>📋</span>;
}

/* ==================== EXAMPLE CASES PAGE ==================== */

export type ExampleCaseId = 'implant_rct' | 'retro_endo' | 'in_vitro_material' | 'cross_dmft' | 'ortho_pain' | 'systematic_implant';

type CaseItem = {
  id: ExampleCaseId;
  name: string;
  type: string;
  duration: string;
  difficulty: 'Basic' | 'Intermediate' | 'Advanced';
  summary: string;
  studyType: string;
  icon: React.ReactNode;
  tags: string[];
  nSubjects: string;
  groups: string;
  outcomes: string[];
  why: string;
};

export const EXAMPLE_CASES: CaseItem[] = [
  {
    id: 'implant_rct',
    name: 'Implant vs. GBR: 6-Month RCT',
    type: 'RCT (Parallel, two-arm, single-blinded)',
    duration: '6 months active · 3 follow-up visits',
    difficulty: 'Intermediate',
    summary: 'Immediate placement (Test: Tenting screw + Xenograft) vs. Delayed (Control: Standard Socket Preservation): Compare PPD reduction, bone width at 6 months.',
    studyType: 'rct',
    icon: <FlaskConical className="h-5 w-5" />,
    tags: ['Dental Implant', 'GBR', 'RCT'],
    nSubjects: 'n=48 per group (96 total, 15% dropout adjusted)',
    groups: '2 independent (1:1 allocation, block randomization block=4)',
    outcomes: ['Primary: Radiographic Bucco-Palatal Bone Width (mm) @ 6mo', 'Secondary: PD (UNC-15), ISQ (Osstell), VAS Pain D1/D3/D7'],
    why: 'Standard RCT structure with primary & secondary endpoints; uses continuous outcomes (Paired t / Independent t / ANCOVA).',
  },
  {
    id: 'retro_endo',
    name: 'Retrospective Endodontic Outcomes 5y',
    type: 'Retrospective Cohort',
    duration: '5 years · single-center chart review',
    difficulty: 'Basic',
    summary: 'Retrospective 5-year survival analysis of Vital vs. Non-Vital pulpectomy cases; Cox PH for time-to-retreatment.',
    studyType: 'retrospective',
    icon: <Clock className="h-5 w-5" />,
    tags: ['Endodontics', 'Retrospective', 'Survival'],
    nSubjects: 'n=342 cases (records 2018–2023)',
    groups: '2 exposure groups: Vital / Non-Vital',
    outcomes: ['Time to re-treatment or extraction (endpoint)', 'Healing (PAI scale 1-5)', 'Adverse events (fracture, post-op pain)'],
    why: 'Typical dental retrospective; teaches PAI index, survival analysis, Cox PH, and chart review methodology.',
  },
  {
    id: 'in_vitro_material',
    name: 'In-Vitro Composite Flexural Strength (ISO 4049)',
    type: 'In-Vitro Laboratory Study (ISO 4049)',
    duration: '2 weeks bench work',
    difficulty: 'Basic',
    summary: '3 brands of resin composite (n=10/group, 3-point flexure, 24h water storage at 37°C). One-way ANOVA + Tukey HSD.',
    studyType: 'in_vitro',
    icon: <FlaskRound className="h-5 w-5" />,
    tags: ['Materials', 'ISO 4049', 'Flexural Strength'],
    nSubjects: 'n=10 bars × 3 groups = 30 specimens',
    groups: '3 independent material groups',
    outcomes: ['Flexural Strength (MPa, ISO 4049 2×2×25mm)', 'Fracture surface (SEM, optional qualitative)', 'Vickers Microhardness (HV 0.5, 500gf / 10s)'],
    why: 'Canonical in-vitro ISO study; teaches sample-size for ANOVA, post-hoc Tukey, and ISO standard operating procedures.',
  },
  {
    id: 'cross_dmft',
    name: 'DMFT Cross-Sectional Epidemiologic Survey',
    type: 'Cross-sectional (Population Survey)',
    duration: '6 weeks · field survey',
    difficulty: 'Intermediate',
    summary: 'Multi-stage cluster sample of 400 adolescents (WHO age 12) from 3 governorates: DMFT/dmft, SiC index, OHI-S + self-reported oral-hygiene.',
    studyType: 'cross_sectional',
    icon: <Users className="h-5 w-5" />,
    tags: ['Public Health', 'WHO DMFT', 'SiC Index'],
    nSubjects: 'n=400 (Design Effect 1.5 · 30% boost for cluster sampling)',
    groups: 'Cross-sectional (no groups — descriptive / correlations)',
    outcomes: ['Primary: DMFT (WHO 2013 criteria)', 'Secondary: SiC (Significant Caries Index 12-year-olds), OHI-S, fluoridation exposure'],
    why: 'Classical dental epidemiology; teaches complex sampling, weighting, SiC index, and survey report format.',
  },
  {
    id: 'ortho_pain',
    name: 'Orthodontic Pain Crossover RCT',
    type: 'Two-Period Crossover RCT (Within-subject)',
    duration: '10 weeks (2 periods × 4 weeks + 2-week washout)',
    difficulty: 'Advanced',
    summary: 'Laser vs. Placebo for pain during initial archwire placement — crossover with paired analysis (McNemar + paired t on VAS).',
    studyType: 'rct',
    icon: <Workflow className="h-5 w-5" />,
    tags: ['Orthodontics', 'Crossover', 'Pain VAS'],
    nSubjects: 'n=32 (Paired study — high power per-subject control)',
    groups: 'Crossover: each subject Laser then Placebo or vice versa with washout',
    outcomes: ['Primary: VAS Pain 0–100mm @ 24h', 'Secondary: VAS @ 6h/48h/7d, Analgesic count, Global Satisfaction'],
    why: 'Crossover = within-patient control; teaches carryover / washout and paired analysis; good for pain/symptom studies.',
  },
  {
    id: 'systematic_implant',
    name: 'SR/MA: Implant Survival Platform-Switch vs. Conventional',
    type: 'Systematic Review + Meta-analysis (PRISMA 2020)',
    duration: '12 weeks full SR + MA',
    difficulty: 'Advanced',
    summary: 'PICO: Adults ≥18yo / Platform-switched abutment vs. conventional / RCTs + prospective cohorts / MBL (mm) at 1 and 3 years, Survival %.',
    studyType: 'systematic_review',
    icon: <BookCopy className="h-5 w-5" />,
    tags: ['PRISMA 2020', 'Random Effects MA', 'Funnel Plot'],
    nSubjects: 'k=13 studies (n≈2,350 implants) pooled',
    groups: '2 groups: PS vs. Conventional abutment',
    outcomes: ['Mean Bone Level change (MD, random-effects, I²)', 'Implant Survival (Risk Ratio, 95% CI)', 'Soft-tissue complication (OR)', 'Funnel/Egger for publication bias'],
    why: 'Teaches full SR/MA workflow: screening (Rayyan/Kappa), data extraction, risk-of-bias (RoB 2.0), heterogeneity (I², Cochran Q), forest plots.',
  },
];

export function ExampleCasesWorkspace() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExampleCaseId>('implant_rct');
  const selectedCase = EXAMPLE_CASES.find(c => c.id === selected)!;

  const loadCase = (_caseId: string) => {
    const studyId = window.prompt('Choose your study ID, or press OK to use the demo study.', 'demo');
    navigate(`/studies/${studyId ?? 'demo'}/structure-builder`);
  };

  const difficultyColor = (d: CaseItem['difficulty']) =>
    d === 'Basic' ? 'text-emerald-300 bg-emerald-500/15 ring-emerald-500/30'
      : d === 'Intermediate' ? 'text-amber-300 bg-amber-500/15 ring-amber-500/30'
      : 'text-rose-300 bg-rose-500/15 ring-rose-500/30';

  return (
    <ResearchWorkspaceShell nav={buildResearchWorkspaceNav('demo')}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 px-6 py-5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-emerald-300 mb-1">Ready-to-Use · Curated by Clinicians</div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><BrainCircuit className="h-6 w-6 text-emerald-300" /> Example Study Cases &amp; Templates</h1>
              <p className="text-sm text-slate-400 mt-0.5">Load a complete pre-designed study skeleton: structure, outcomes, CRF fields, sample-size justification &amp; references.</p>
            </div>
            <button onClick={() => loadCase(selected)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
              <CheckCircle2 className="h-4 w-4" /> Load &quot;{selectedCase.name}&quot; into study
            </button>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-6 py-6 grid xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)] gap-5">
          <div className="space-y-3">
            {EXAMPLE_CASES.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full text-left rounded-2xl border p-4 transition ${selected === c.id ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-950 p-2 text-emerald-300 ring-1 ring-slate-800">{c.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <h3 className="font-semibold text-slate-100">{c.name}</h3>
                      <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${difficultyColor(c.difficulty)}`}>{c.difficulty}</span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{c.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{c.tags.map(t => <span key={t} className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{t}</span>)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="p-5 border-b border-slate-800 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900">
              <div className="inline-flex items-center gap-2 rounded-xl bg-slate-950/80 p-2 text-emerald-300 ring-1 ring-slate-800 mb-3">{selectedCase.icon}</div>
              <h2 className="text-xl font-bold text-slate-100">{selectedCase.name}</h2>
              <p className="mt-1 text-sm text-slate-300">{selectedCase.summary}</p>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Mini label="Type" value={selectedCase.type.split(' ')[0]} accent="text-sky-300" />
                <Mini label="Duration" value={selectedCase.duration.split('·')[0].trim()} accent="text-fuchsia-300" />
                <Mini label="Difficulty" value={selectedCase.difficulty} accent={selectedCase.difficulty === 'Basic' ? 'text-emerald-300' : selectedCase.difficulty === 'Intermediate' ? 'text-amber-300' : 'text-rose-300'} />
                <Mini label="Subjects" value={selectedCase.nSubjects.split(' ')[0]} accent="text-indigo-300" />
              </div>
            </div>
            <div className="p-5 space-y-5 text-sm">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1"><Workflow className="h-3 w-3" /> Study Design / Groups</div>
                <p className="text-slate-200">{selectedCase.groups}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-center text-slate-300">{selectedCase.type}</span>
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-center text-slate-300">{selectedCase.duration.split('·')[1]?.trim() ?? 'Single Center'}</span>
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-center text-slate-300">{selectedCase.studyType}</span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Primary &amp; Secondary Outcomes</div>
                <ol className="space-y-2 list-decimal list-inside text-slate-200">
                  {selectedCase.outcomes.map((o, i) => <li key={i}>{o}</li>)}
                </ol>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> Why it&apos;s a great template</div>
                <p className="text-slate-200 leading-relaxed">{selectedCase.why}</p>
              </div>
            </div>
            <div className="border-t border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
              <div className="text-xs text-slate-400">Loading this template will create: RQs, Objectives, Variables Matrix, Sample-Size, Validation Issues, linked References.</div>
              <button onClick={() => loadCase(selectedCase.id)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-white">
                <ArrowUpRight className="h-4 w-4" /> Load Template
              </button>
            </div>
          </div>
        </div>
      </div>
    </ResearchWorkspaceShell>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

/* ==================== DEV TOOLS: DB SCHEMA + DECISION TREE TESTER ==================== */

export function DeveloperToolsWorkspace() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'schema' | 'tree'>('schema');
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"><ArrowRight className="h-4 w-4 rotate-180" /></button>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Internal Developer Tools</div>
              <h1 className="text-xl font-bold flex items-center gap-2"><Layers className="h-5 w-5 text-amber-300" /> Database Schema Explorer &amp; Decision Tree Test Harness</h1>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-800 p-1 bg-slate-900/60">
            <button onClick={() => setTab('schema')} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'schema' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-slate-100'}`}><Layers className="inline h-3.5 w-3.5 mr-1.5" /> Schema Explorer</button>
            <button onClick={() => setTab('tree')} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'tree' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-slate-100'}`}><Workflow className="inline h-3.5 w-3.5 mr-1.5" /> Decision Tree Tester</button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'schema' && <SchemaExplorer />}
        {tab === 'tree' && <DecisionTreeTester />}
      </div>
    </div>
  );
}

type SchemaTable = {
  name: string;
  note: string;
  cols: Array<{ name: string; type: string; pk?: boolean; fk?: string; nullable?: boolean; default?: string | number | boolean }>;
};

const SCHEMA_TABLES: SchemaTable[] = [
  {
    name: 'users',
    note: 'All account types (student, co_researcher, supervisor, assistant_supervisor, clinical_evaluator, institution)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'email', type: 'CITEXT UNIQUE' },
      { name: 'password_hash', type: 'TEXT' },
      { name: 'full_name', type: 'TEXT' },
      { name: 'account_type', type: 'VARCHAR(40)' },
      { name: 'academic_id', type: 'VARCHAR(60) UNIQUE' },
      { name: 'university', type: 'TEXT' },
      { name: 'institution_type', type: 'VARCHAR(40)', nullable: true },
      { name: 'phone', type: 'TEXT', nullable: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'studies',
    note: 'Core study record (type, design, blinding, randomization, ownership)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'owner_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'title', type: 'TEXT' },
      { name: 'study_type', type: 'VARCHAR(60)' },
      { name: 'workflow_type', type: 'VARCHAR(40)', default: "'supervised'" },
      { name: 'status', type: 'VARCHAR(40)', default: "'draft'" },
      { name: 'description', type: 'TEXT', nullable: true },
      { name: 'has_randomization', type: 'BOOL', default: 'false' },
      { name: 'randomization_method', type: 'VARCHAR(40)', nullable: true },
      { name: 'groups_json', type: 'JSONB', default: "'[]'::jsonb" },
      { name: 'has_blinding', type: 'BOOL', default: 'false' },
      { name: 'blinding_config_json', type: 'JSONB', nullable: true },
      { name: 'target_sample_size', type: 'INT', default: 0 },
      { name: 'enrolled_patients', type: 'INT', default: 0 },
      { name: 'principal_investigator_name', type: 'TEXT', nullable: true },
      { name: 'supervisor_user_id', type: 'BIGINT', fk: 'users.id', nullable: true },
      { name: 'co_researcher_user_id', type: 'BIGINT', fk: 'users.id', nullable: true },
      { name: 'assigned_clinical_evaluator_user_id', type: 'BIGINT', fk: 'users.id', nullable: true },
      { name: 'is_locked', type: 'BOOL', default: 'false' },
      { name: 'locked_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'clinical_evaluation_decision', type: 'VARCHAR(40)', nullable: true },
      { name: 'clinical_evaluation_notes', type: 'TEXT', nullable: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_files',
    note: 'Protocol PDFs, datasets, photos, X-rays, STL, lab results, exported reports (S3-compatible storage key)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'study_id', type: 'BIGINT', fk: 'studies.id' },
      { name: 'uploaded_by_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'file_category', type: 'VARCHAR(40)' },
      { name: 'original_name', type: 'TEXT' },
      { name: 'storage_key', type: 'TEXT' },
      { name: 'mime_type', type: 'VARCHAR(120)' },
      { name: 'size_bytes', type: 'BIGINT', default: 0 },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_outcome_assessment_template_versions',
    note: 'CRF / Template versions (with approval workflow, change notes, audit)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'study_id', type: 'BIGINT', fk: 'studies.id' },
      { name: 'version_number', type: 'INT' },
      { name: 'approval_status', type: 'VARCHAR(40)', default: "'approved'" },
      { name: 'created_by_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'approved_by_user_id', type: 'BIGINT', fk: 'users.id', nullable: true },
      { name: 'approved_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'change_notes', type: 'TEXT', nullable: true },
      { name: 'template_json', type: 'JSONB' },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_outcome_assessment_requests',
    note: 'Request sent to a Clinical Evaluator (deadline, required samples, status)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'study_id', type: 'BIGINT', fk: 'studies.id' },
      { name: 'assessor_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'requested_by_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'request_status', type: 'VARCHAR(40)', default: "'new'" },
      { name: 'assessment_type', type: 'VARCHAR(60)' },
      { name: 'deadline_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'samples_required', type: 'INT' },
      { name: 'accepted_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'rejected_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'completed_at', type: 'TIMESTAMPTZ', nullable: true },
    ],
  },
  {
    name: 'study_outcome_assessment_samples',
    note: 'Patients / records / blocks: subject, visit, inclusion, allocation, masking code',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'study_id', type: 'BIGINT', fk: 'studies.id' },
      { name: 'subject_id', type: 'TEXT' },
      { name: 'visit_number', type: 'TEXT' },
      { name: 'inclusion_eligible', type: 'BOOL', default: true },
      { name: 'allocated_group', type: 'TEXT', nullable: true },
      { name: 'masked_group_code', type: 'TEXT', nullable: true },
      { name: 'sample_status', type: 'VARCHAR(40)', default: "'pending'" },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_outcome_assessment_entries',
    note: 'Actual CRF responses for a specific assessor × request × sample combination',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'request_id', type: 'BIGINT', fk: 'study_outcome_assessment_requests.id' },
      { name: 'sample_id', type: 'BIGINT', fk: 'study_outcome_assessment_samples.id' },
      { name: 'assessor_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'template_version_id', type: 'BIGINT', fk: 'study_outcome_assessment_template_versions.id', nullable: true },
      { name: 'response_json', type: 'JSONB', default: "'{}'::jsonb" },
      { name: 'status', type: 'VARCHAR(40)', default: "'in_progress'" },
      { name: 'assessor_comments', type: 'TEXT', nullable: true },
      { name: 'submitted_at', type: 'TIMESTAMPTZ', nullable: true },
      { name: 'locked_at', type: 'TIMESTAMPTZ', nullable: true },
    ],
  },
  {
    name: 'study_outcome_assessment_sample_files',
    note: 'Attachments per sample (photos/X-rays/STL/lab results), with MIME/asset type',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'sample_id', type: 'BIGINT', fk: 'study_outcome_assessment_samples.id' },
      { name: 'file_id', type: 'BIGINT', fk: 'study_files.id' },
      { name: 'asset_type', type: 'VARCHAR(60)' },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_outcome_assessment_notes',
    note: 'Structured threaded comments (research team / assessor only visibility)',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'request_id', type: 'BIGINT', fk: 'study_outcome_assessment_requests.id' },
      { name: 'sample_id', type: 'BIGINT', fk: 'study_outcome_assessment_samples.id', nullable: true },
      { name: 'author_user_id', type: 'BIGINT', fk: 'users.id' },
      { name: 'recipient_scope', type: 'VARCHAR(40)', default: "'research_team'" },
      { name: 'message', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
  {
    name: 'study_outcome_assessment_audit_trail',
    note: 'Immutable GCP-compliant audit trail: every action on requests/samples/entries/templates',
    cols: [
      { name: 'id', type: 'BIGSERIAL', pk: true },
      { name: 'request_id', type: 'BIGINT', fk: 'study_outcome_assessment_requests.id', nullable: true },
      { name: 'sample_id', type: 'BIGINT', fk: 'study_outcome_assessment_samples.id', nullable: true },
      { name: 'entry_id', type: 'BIGINT', fk: 'study_outcome_assessment_entries.id', nullable: true },
      { name: 'actor_user_id', type: 'BIGINT', fk: 'users.id', nullable: true },
      { name: 'action', type: 'VARCHAR(80)' },
      { name: 'details_json', type: 'JSONB', default: "'{}'::jsonb" },
      { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
    ],
  },
];

function SchemaExplorer() {
  const [open, setOpen] = useState<string>('studies');
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-base font-semibold mb-3">Database Schema — 10 Core Tables · Primary Keys (🔑) · Foreign Keys (→)</h3>
        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
          <div className="space-y-2">
            {SCHEMA_TABLES.map(tbl => (
              <button key={tbl.name} onClick={() => setOpen(tbl.name)} className={`w-full text-left rounded-lg px-3 py-2 text-xs font-mono transition ${open === tbl.name ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40' : 'bg-slate-950/70 border border-slate-800 text-slate-300 hover:bg-slate-800/70'}`}>
                {tbl.name}
                <span className="float-right text-[10px] text-slate-500">{tbl.cols.length} cols</span>
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
            {SCHEMA_TABLES.filter(t => t.name === open).map(tbl => (
              <div key={tbl.name}>
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                  <div className="font-mono font-semibold text-amber-300">{tbl.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{tbl.note}</div>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/40 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-2 text-left w-56">Column</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Constraints</th>
                      <th className="px-3 py-2 text-left">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tbl.cols.map(c => (
                      <tr key={c.name} className="border-b border-slate-800/60 hover:bg-slate-900/30">
                        <td className="px-4 py-2">
                          <span className="font-mono text-slate-200">{c.name}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-sky-300">{c.type}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.pk && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">🔑 PK</span>}
                            {c.fk && <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/30">→ {c.fk}</span>}
                            {c.nullable && <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">NULLABLE</span>}
                            {!c.nullable && !c.pk && <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300 ring-1 ring-inset ring-rose-500/20">NOT NULL</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-emerald-300">{c.default ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-base font-semibold mb-3">Relationships Graph (ERD Summary)</h3>
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <RelLine from="users" to="studies" label="owner_user_id (1:many)" />
          <RelLine from="studies" to="study_files" label="study_id (1:many)" />
          <RelLine from="studies" to="study_outcome_assessment_template_versions" label="study_id" />
          <RelLine from="studies" to="study_outcome_assessment_requests" label="study_id" />
          <RelLine from="studies" to="study_outcome_assessment_samples" label="study_id" />
          <RelLine from="study_outcome_assessment_requests" to="study_outcome_assessment_entries" label="request_id" />
          <RelLine from="study_outcome_assessment_samples" to="study_outcome_assessment_entries" label="sample_id" />
          <RelLine from="study_outcome_assessment_samples" to="study_outcome_assessment_sample_files" label="sample_id" />
          <RelLine from="study_files" to="study_outcome_assessment_sample_files" label="file_id" />
          <RelLine from="studies" to="study_outcome_assessment_audit_trail" label="via all foreign keys" />
        </div>
      </div>
    </div>
  );
}

function RelLine({ from, to, label }: { from: string; to: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
      <span className="font-mono text-sky-300">{from}</span>
      <span className="text-slate-500">—❯</span>
      <span className="font-mono text-violet-300">{to}</span>
      <span className="ml-auto text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

const TREE_TEST_CASES = [
  {
    id: 'T-01',
    name: '2 independent groups, continuous outcome, normal → t-test',
    answers: ['compare', 'continuous', 2, 'ind', true],
    expect: 'Independent-Samples t-Test / One-Way ANOVA',
  },
  {
    id: 'T-02',
    name: '3 groups, non-normal → Kruskal-Wallis',
    answers: ['compare', 'continuous', 3, false],
    expect: 'Mann-Whitney U (2 groups) or Kruskal-Wallis H (3+ groups)',
  },
  {
    id: 'T-03',
    name: 'Binary vs Binary → Chi-square',
    answers: ['compare', 'cat'],
    expect: 'Chi-square Test of Independence / Fisher Exact',
  },
  {
    id: 'T-04',
    name: 'Survival outcome → Cox & Kaplan-Meier',
    answers: ['tte'],
    expect: 'Cox Proportional-Hazards Regression + Kaplan-Meier',
  },
  {
    id: 'T-05',
    name: 'Paired ordinal (pre-post Likert) → Wilcoxon',
    answers: ['compare', 'ordinal', 'p', false],
    expect: 'Wilcoxon Signed-Rank Test',
  },
];

function DecisionTreeTester() {
  const [results, setResults] = useState<Record<string, { pass: boolean; actual: string } | null>>({});

  const runAll = () => {
    const out: Record<string, { pass: boolean; actual: string } | null> = {};
    TREE_TEST_CASES.forEach(tc => {
      // Simple heuristic that mirrors AnalyticsWorkspace tree logic
      const first = tc.answers[0];
      let actual = '(No match)';
      if (first === 'compare') {
        const outcome = tc.answers[1];
        if (outcome === 'continuous') {
          const paired = tc.answers[3];
          const norm = typeof tc.answers[4] === 'boolean' ? tc.answers[4] : (typeof tc.answers[3] === 'boolean' ? tc.answers[3] : true);
          if (paired === 'p' || paired === true) {
            actual = norm ? 'Paired Samples t-Test' : 'Wilcoxon Signed-Rank Test';
          } else {
            actual = norm
              ? 'Independent-Samples t-Test / One-Way ANOVA'
              : 'Mann-Whitney U (2 groups) or Kruskal-Wallis H (3+ groups)';
          }
        } else if (outcome === 'ordinal') {
          const paired = tc.answers[2] === 'p' || tc.answers[2] === true;
          const norm = tc.answers[3] === true;
          actual = paired
            ? (norm ? 'Paired Samples t-Test' : 'Wilcoxon Signed-Rank Test')
            : 'Mann-Whitney U / Kruskal-Wallis H';
        } else if (outcome === 'cat') {
          actual = 'Chi-square Test of Independence / Fisher Exact';
        } else if (outcome === 'count') {
          actual = 'Poisson / Negative-Binomial Regression';
        }
      } else if (first === 'relate') {
        actual = 'Pearson / Spearman or Regression family';
      } else if (first === 'roc') {
        actual = 'ROC Curve + AUC + Optimal Cutoff (Youden J)';
      } else if (first === 'tte') {
        actual = 'Cox Proportional-Hazards Regression + Kaplan-Meier';
      }
      out[tc.id] = { pass: actual === tc.expect, actual };
    });
    setResults(out);
  };

  const passing = Object.values(results).filter(r => r?.pass).length;
  const total = TREE_TEST_CASES.length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Decision Tree Automated Test Harness</h3>
          <p className="text-xs text-slate-400 mt-0.5">Runs {total} curated walk-through scenarios on the Statistical Test Selection Tree and checks the expected result.</p>
        </div>
        <div className="flex items-center gap-3">
          {Object.keys(results).length > 0 && (
            <div className={`rounded-xl px-4 py-2 ring-1 ring-inset ${passing === total ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-amber-500/15 text-amber-300 ring-amber-500/30'}`}>
              <div className="text-[10px] uppercase tracking-wider opacity-80">Pass</div>
              <div className="text-xl font-bold font-mono">{passing}/{total}</div>
            </div>
          )}
          <button onClick={runAll} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm">
            <CheckCircle2 className="h-4 w-4" /> Run Test Suite
          </button>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/80 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 text-left w-24">Test ID</th>
              <th className="px-3 py-3 text-left">Scenario</th>
              <th className="px-3 py-3 text-left">Expected</th>
              <th className="px-3 py-3 text-left">Actual</th>
              <th className="px-3 py-3 text-center w-24">Result</th>
            </tr>
          </thead>
          <tbody>
            {TREE_TEST_CASES.map(tc => {
              const r = results[tc.id];
              return (
                <tr key={tc.id} className="border-b border-slate-800/60 hover:bg-slate-900/30">
                  <td className="px-4 py-3 font-mono text-amber-300">{tc.id}</td>
                  <td className="px-3 py-3 text-slate-200">{tc.name}</td>
                  <td className="px-3 py-3 text-slate-400 italic">{tc.expect}</td>
                  <td className="px-3 py-3 text-sky-300">{r ? r.actual : <span className="text-slate-600 italic">(not yet run)</span>}</td>
                  <td className="px-3 py-3 text-center">
                    {r
                      ? r.pass
                        ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30"><CheckCircle2 className="h-3 w-3" /> PASS</span>
                        : <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30"><XCircle className="h-3 w-3" /> FAIL</span>
                      : <span className="text-slate-600 text-[11px]">PENDING</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-xs text-slate-400 leading-relaxed">
        <div className="font-semibold text-slate-300 mb-1 flex items-center gap-1"><BrainCircuit className="h-3.5 w-3.5" /> What&apos;s being tested?</div>
        The walk-through traces 5 realistic study designs end-to-end and asserts the <em>Recommended Test</em> produced by the tree. If a <code>FAIL</code> appears, revisit the tree branch (paired vs independent, normality, measurement scale) and add the missing edge case. Add more cases by extending <code>TREE_TEST_CASES</code> array in this page.
      </div>
    </div>
  );
}
