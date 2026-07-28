/**
 * ClinResearch AI — Study Types Standard Library
 * Defines the canonical clinical study types and metadata.
 */

export type StudyTypeId =
  | 'rct'
  | 'prospective'
  | 'retrospective'
  | 'cross_sectional'
  | 'in_vitro'
  | 'systematic_review'
  | 'meta_analysis';

export interface StudyTypeInfo {
  id: StudyTypeId;
  labelEn: string;
  labelAr: string;
  shortLabel: string;
  descriptionEn: string;
  descriptionAr: string;
  primaryGuideline: string;
  color: string;
  badgeClass: string;
  workflowSummaryAr: string;
  screeningModeAr: string;
  defaultGroups: string[];
  supportsRandomization: boolean;
  supportsBlinding: boolean;
}

export const STUDY_TYPES: Record<StudyTypeId, StudyTypeInfo> = {
  rct: {
    id: 'rct',
    labelEn: 'Randomized Controlled Trial (RCT)',
    labelAr: 'تجربة عشوائية مضبوطة (RCT)',
    shortLabel: 'RCT',
    descriptionEn: 'Interventional study with randomized group allocation and blinding standards.',
    descriptionAr: 'دراسة تدخلية تعتمد التوزيع العشوائي وإجراءات التعمية المنهجية.',
    primaryGuideline: 'CONSORT 2010 / SPIRIT 2013 / ICH E6(R3)',
    color: 'teal',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-200',
    workflowSummaryAr: 'يفتح مسارًا تدخليًا كاملاً مع عشوائية وربط مباشر باستمارة الفحص وتخصيص المجموعات.',
    screeningModeAr: 'Screening + randomization + blinded allocation',
    defaultGroups: ['Experimental', 'Control'],
    supportsRandomization: true,
    supportsBlinding: true,
  },
  prospective: {
    id: 'prospective',
    labelEn: 'Prospective Study',
    labelAr: 'دراسة استباقية (Prospective Cohort)',
    shortLabel: 'Prospective',
    descriptionEn: 'Observational follow-up study tracking outcomes over time.',
    descriptionAr: 'دراسة رصدية تتبع عينة البحث مستقبلياً لمراقبة النتائج.',
    primaryGuideline: 'STROBE / NOS / Kaplan-Meier / GEE',
    color: 'blue',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    workflowSummaryAr: 'يفتح مسار متابعة مستقبلية بدون عشوائية افتراضيًا، مع إمكانية تنظيم مجموعات المقارنة عند الحاجة.',
    screeningModeAr: 'Eligibility + cohort follow-up registration',
    defaultGroups: ['Exposed', 'Comparison'],
    supportsRandomization: false,
    supportsBlinding: true,
  },
  retrospective: {
    id: 'retrospective',
    labelEn: 'Retrospective Study',
    labelAr: 'دراسة استرجاعية (Retrospective / EHR)',
    shortLabel: 'Retrospective',
    descriptionEn: 'Observational analysis using historical medical records or registry data.',
    descriptionAr: 'دراسة تحليلية تعتمد البيانات والسجلات الصحية التاريخية.',
    primaryGuideline: 'STROBE / RECORD / Propensity Matching',
    color: 'purple',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
    workflowSummaryAr: 'يعطّل العشوائية تلقائيًا ويركّز على السجلات التاريخية والتحليل المقارن.',
    screeningModeAr: 'Record abstraction / retrospective data capture',
    defaultGroups: ['Case', 'Comparison'],
    supportsRandomization: false,
    supportsBlinding: false,
  },
  cross_sectional: {
    id: 'cross_sectional',
    labelEn: 'Cross-Sectional Study',
    labelAr: 'دراسة مقطعية (Cross-Sectional Survey)',
    shortLabel: 'Cross-Sectional',
    descriptionEn: 'Epidemiological survey analyzing population prevalence at a single timepoint.',
    descriptionAr: 'دراسة مسحية وبائية لتقييم الانتشار في نقطة زادية واحدة.',
    primaryGuideline: 'STROBE / AXIS / Cochran / WHO Indices',
    color: 'amber',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    workflowSummaryAr: 'يفتح مسار استبيان/فحص مقطعي ويركّز على التقاط نقطة زمنية واحدة بدون توزيع عشوائي.',
    screeningModeAr: 'Cross-sectional screening form',
    defaultGroups: ['Survey Cohort'],
    supportsRandomization: false,
    supportsBlinding: false,
  },
  in_vitro: {
    id: 'in_vitro',
    labelEn: 'In Vitro Study',
    labelAr: 'دراسة مخبرية (In Vitro Laboratory)',
    shortLabel: 'In Vitro',
    descriptionEn: 'Laboratory experiment on dental materials, mechanics, or tissue specimens.',
    descriptionAr: 'تجربة مخبرية على المواد السنية أو العينات الميكانيكية.',
    primaryGuideline: 'CRIS Guidelines / ISO Standards (11405/29022)',
    color: 'emerald',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    workflowSummaryAr: 'مسار مخبري للأبحاث المختبرية الحالية والمتوافقة مع النسخ القديمة من النظام.',
    screeningModeAr: 'Laboratory specimen worksheet',
    defaultGroups: ['Material A', 'Material B'],
    supportsRandomization: true,
    supportsBlinding: true,
  },
  systematic_review: {
    id: 'systematic_review',
    labelEn: 'Systematic Review',
    labelAr: 'Systematic Review',
    shortLabel: 'Systematic Review',
    descriptionEn: 'Evidence synthesis study with protocol registration, search strategy, screening, extraction, and risk-of-bias workflow.',
    descriptionAr: 'Evidence synthesis workflow with protocol registration, search strategy, screening, extraction, and risk-of-bias assessment.',
    primaryGuideline: 'PRISMA 2020 / PRISMA-P / PROSPERO / AMSTAR 2 / ROBIS',
    color: 'sky',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    workflowSummaryAr: 'Review workflow for protocol registration, eligibility criteria, screening, extraction, and risk-of-bias mapping.',
    screeningModeAr: 'Search strategy + screening + extraction',
    defaultGroups: ['Included Studies'],
    supportsRandomization: false,
    supportsBlinding: false,
  },
  meta_analysis: {
    id: 'meta_analysis',
    labelEn: 'Meta-Analysis',
    labelAr: 'Meta-Analysis',
    shortLabel: 'Meta-Analysis',
    descriptionEn: 'Quantitative evidence synthesis with effect-size extraction, heterogeneity, publication-bias, and sensitivity analyses.',
    descriptionAr: 'Quantitative evidence synthesis with pooling, heterogeneity, publication-bias, and sensitivity analysis.',
    primaryGuideline: 'PRISMA 2020 / PRISMA-NMA / MOOSE / Cochrane Handbook',
    color: 'rose',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    workflowSummaryAr: 'Meta-analysis workflow for effect extraction, pooling model choice, heterogeneity, and publication-bias checks.',
    screeningModeAr: 'Effect extraction + pooling + bias checks',
    defaultGroups: ['Included Studies'],
    supportsRandomization: false,
    supportsBlinding: false,
  },
};

export const STUDY_TYPE_OPTIONS = Object.values(STUDY_TYPES);
export const CREATE_STUDY_TYPE_OPTIONS = STUDY_TYPE_OPTIONS.filter((item) =>
  ['rct', 'prospective', 'retrospective', 'cross_sectional', 'systematic_review', 'meta_analysis'].includes(item.id),
);

/**
 * Normalizes legacy free-text study type values into one of the canonical keys.
 */
export function normalizeStudyType(rawType?: string | null): StudyTypeId {
  if (!rawType) return 'rct';

  const clean = rawType.trim().toLowerCase();

  if (clean.includes('rct') || clean.includes('random') || clean.includes('عشوائ')) {
    return 'rct';
  }
  if (clean.includes('prospect') || clean.includes('مستقبل') || clean.includes('استباق')) {
    return 'prospective';
  }
  if (clean.includes('retro') || clean.includes('استرجاع') || clean.includes('سجلات')) {
    return 'retrospective';
  }
  if (clean.includes('cross') || clean.includes('sectional') || clean.includes('مقطع') || clean.includes('مسح')) {
    return 'cross_sectional';
  }
  if (clean.includes('systematic') || clean.includes('review') || clean.includes('prisma') || clean.includes('prospero')) {
    return 'systematic_review';
  }
  if (clean.includes('meta') || clean.includes('metaanalysis') || clean.includes('pooled') || clean.includes('heterogeneity')) {
    return 'meta_analysis';
  }
  if (clean.includes('vitro') || clean.includes('مخبر') || clean.includes('معمل')) {
    return 'in_vitro';
  }

  return 'rct';
}

export function getStudyTypeInfo(rawType?: string | null): StudyTypeInfo {
  const normalizedKey = normalizeStudyType(rawType);
  return STUDY_TYPES[normalizedKey];
}
