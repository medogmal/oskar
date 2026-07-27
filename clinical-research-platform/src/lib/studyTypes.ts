/**
 * ClinResearch AI — Study Types Standard Library
 * Defines the 5 canonical clinical study types and metadata.
 */

export type StudyTypeId = 'rct' | 'prospective' | 'retrospective' | 'cross_sectional' | 'in_vitro';

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
  },
};

export const STUDY_TYPE_OPTIONS = Object.values(STUDY_TYPES);

/**
 * Normalizes legacy free-text study type values into one of the 5 canonical keys.
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
  if (clean.includes('vitro') || clean.includes('مخبر') || clean.includes('معمل')) {
    return 'in_vitro';
  }

  return 'rct';
}

export function getStudyTypeInfo(rawType?: string | null): StudyTypeInfo {
  const normalizedKey = normalizeStudyType(rawType);
  return STUDY_TYPES[normalizedKey];
}
