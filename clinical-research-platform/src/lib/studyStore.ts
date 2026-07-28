import type {
  VariableMapping,
  ResearchQuestion,
  StudyObjective,
  ValidationItem,
  PhaseApproval,
  AppNotification,
  AuditLogEntry,
  ErrorCatalogEntry,
} from '../types/clinresearch';

const PREFIX = 'clinresearch.store.';

const getStore = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const setStore = <T>(key: string, value: T) => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const arrayAppend = <T extends { id?: string }>(key: string, item: T, autoId = true) => {
  const list = getStore<T[]>(key, []);
  const finalItem = autoId && !item.id ? ({ ...item, id: crypto.randomUUID() } as T) : item;
  list.unshift(finalItem);
  setStore(key, list);
  return finalItem;
};

const arrayUpdate = <T extends { id: string }>(key: string, id: string, patch: Partial<T>) => {
  const list = getStore<T[]>(key, []);
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  setStore(key, list);
  return list[idx];
};

const arrayRemove = <T extends { id: string }>(key: string, id: string) => {
  const list = getStore<T[]>(key, []);
  const next = list.filter((x) => x.id !== id);
  setStore(key, next);
  return next;
};

const scopedKey = (studyId: string, suffix: string) => `study.${studyId}.${suffix}`;

/* =================== Variables (Mapping Matrix) =================== */
export const listVariables = (studyId: string): VariableMapping[] =>
  getStore<VariableMapping[]>(scopedKey(studyId, 'variables'), []);

export const saveVariable = (studyId: string, v: Omit<VariableMapping, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
  if (v.id) {
    return arrayUpdate<VariableMapping>(scopedKey(studyId, 'variables'), v.id, {
      ...v,
      updatedAt: new Date().toISOString(),
    } as Partial<VariableMapping>);
  }
  const now = new Date().toISOString();
  return arrayAppend(scopedKey(studyId, 'variables'), {
    ...v,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  } as VariableMapping, false);
};

export const deleteVariable = (studyId: string, id: string) =>
  arrayRemove<VariableMapping>(scopedKey(studyId, 'variables'), id);

/* =================== Research Questions =================== */
export const listResearchQuestions = (studyId: string): ResearchQuestion[] =>
  getStore<ResearchQuestion[]>(scopedKey(studyId, 'rqs'), []);

export const saveResearchQuestion = (studyId: string, rq: Omit<ResearchQuestion, 'id' | 'createdAt'> & { id?: string }) => {
  if (rq.id) return arrayUpdate<ResearchQuestion>(scopedKey(studyId, 'rqs'), rq.id, rq);
  return arrayAppend(scopedKey(studyId, 'rqs'), { ...rq, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as ResearchQuestion, false);
};

export const deleteResearchQuestion = (studyId: string, id: string) =>
  arrayRemove<ResearchQuestion>(scopedKey(studyId, 'rqs'), id);

/* =================== Objectives =================== */
export const listObjectives = (studyId: string): StudyObjective[] =>
  getStore<StudyObjective[]>(scopedKey(studyId, 'objectives'), []);

export const saveObjective = (studyId: string, obj: Omit<StudyObjective, 'id' | 'createdAt'> & { id?: string }) => {
  if (obj.id) return arrayUpdate<StudyObjective>(scopedKey(studyId, 'objectives'), obj.id, obj);
  return arrayAppend(scopedKey(studyId, 'objectives'), { ...obj, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as StudyObjective, false);
};

export const deleteObjective = (studyId: string, id: string) =>
  arrayRemove<StudyObjective>(scopedKey(studyId, 'objectives'), id);

/* =================== Validation Items (Issues) =================== */
export const listValidationItems = (studyId: string): ValidationItem[] =>
  getStore<ValidationItem[]>(scopedKey(studyId, 'validation'), []);

export const saveValidationItem = (studyId: string, item: Omit<ValidationItem, 'id' | 'createdAt'> & { id?: string }) => {
  if (item.id) return arrayUpdate<ValidationItem>(scopedKey(studyId, 'validation'), item.id, item);
  return arrayAppend(
    scopedKey(studyId, 'validation'),
    { ...item, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as ValidationItem,
    false
  );
};

export const deleteValidationItem = (studyId: string, id: string) =>
  arrayRemove<ValidationItem>(scopedKey(studyId, 'validation'), id);

export const seedValidationItemsIfEmpty = (studyId: string) => {
  const existing = listValidationItems(studyId);
  if (existing.length > 0) return existing;
  const seeds: Omit<ValidationItem, 'id' | 'createdAt'>[] = [
    {
      studyId,
      severity: 'critical',
      category: 'methodological',
      status: 'open',
      title: 'Missing Randomization Method Declaration',
      detail: 'The study is registered as an RCT but the randomization method (simple / block / stratified) has not been specified. This is a critical methodological flaw that invalidates proper allocation concealment review.',
      suggestedAction: 'Go to Study Design tab and explicitly define the randomization method, block size (if using blocks), stratification factors, and allocation concealment mechanism.',
      location: { section: 'Study Design → Randomization', fieldLabel: 'Randomization Method', page: 2 },
    },
    {
      studyId,
      severity: 'high',
      category: 'statistical',
      status: 'open',
      title: 'No Correction for Multiple Comparisons Defined',
      detail: '4 primary outcome variables and 3 secondary outcome variables are planned with pairwise comparisons. With no multiplicity adjustment (Bonferroni / Holm / Dunnett), the familywise Type-I error rate inflates above 5%.',
      suggestedAction: 'Define the family of hypotheses per outcome and specify a correction method. For exploratory outcomes, explicitly label as such and do not include in confirmatory alpha-spending.',
    },
    {
      studyId,
      severity: 'high',
      category: 'missing_data',
      status: 'pending',
      title: 'Missing Data Handling Policy Not Documented',
      detail: 'The protocol does not describe the classification (MCAR / MAR / MNAR) nor the imputation strategy. Sensitivity analyses are not mentioned.',
      suggestedAction: 'Add a full Missing Data section to the SAP: describe patterns anticipated, classification algorithm, primary imputation method (e.g., MICE, 20 imputations), and sensitivity / tipping-point analysis approach.',
    },
    {
      studyId,
      severity: 'moderate',
      category: 'clinical',
      status: 'open',
      title: 'Pocket Depth Range Not Bound-Validated in CRF',
      detail: 'The numeric field for probing pocket depth allows values from 0 to 999 mm, which is physiologically impossible (clinical max ~15 mm).',
      suggestedAction: 'Apply range validation: PD ∈ [0, 15] mm, CAL ∈ [0, 20] mm, BoP as boolean/percent, Plaque Index ordinal 0-3.',
      location: { section: 'CRF Form Builder → Periodontal Fields' },
    },
    {
      studyId,
      severity: 'moderate',
      category: 'crf_structural',
      status: 'open',
      title: 'Possible Redundant Variable: Age Entry vs. Date of Birth',
      detail: 'The CRF captures both "Age at Screening (years)" and "Date of Birth". One is fully derivable from the other plus screening date, creating possible inconsistency and audit burden.',
      suggestedAction: 'Keep Date of Birth as the source-of-truth and derive Age in reports automatically, or explicitly document which field is authoritative and reconcile both at entry time.',
    },
    {
      studyId,
      severity: 'low',
      category: 'regulatory',
      status: 'pending',
      title: 'Informed Consent Version Not Referenced',
      detail: 'The CRF header has an open-text "Consent obtained" checkbox but no field for Consent Form Version Number and Date of Signature.',
      suggestedAction: 'Add ConsentVersion (text), ConsentSignedAt (date), ConsentWitnessedBy (text or user link) fields to CRF Screening section per GCP requirements.',
    },
    {
      studyId,
      severity: 'info',
      category: 'reference_scope',
      status: 'open',
      title: 'Primary Reference Scope Suggestion',
      detail: 'For this RCT with a subjective outcome (pain VAS), consider explicitly referencing CONSORT 2010 Extension for Patient-Reported Outcomes and ICH E9(R1) Addendum on Estimands and Sensitivity Analysis.',
      suggestedAction: 'Add both references to the protocol bibliography and link this issue to the corresponding citation in the final report.',
    },
  ];
  seeds.forEach((s) => saveValidationItem(studyId, s));
  return listValidationItems(studyId);
};

/* =================== Phase Approvals =================== */
const defaultPhaseDeliverables = (phase: 1 | 2 | 3) => {
  if (phase === 1) {
    return [
      { id: 'p1-1', label: '130 Scientific References Received & Validated', completed: true },
      { id: 'p1-2', label: 'Reference Classification by Study Type', completed: true },
      { id: 'p1-3', label: 'Knowledge Base Index Created', completed: true },
      { id: 'p1-4', label: 'Metadata Catalog Linked', completed: true },
      { id: 'p1-5', label: 'Reference Isolation Tested', completed: true },
      { id: 'p1-6', label: 'RAG Retrieval Accuracy Tested', completed: false },
    ];
  }
  if (phase === 2) {
    return [
      { id: 'p2-1', label: 'Study Elements (PICO + Design) Extracted', completed: false },
      { id: 'p2-2', label: 'CRF Validation (4-layers) Passed', completed: false },
      { id: 'p2-3', label: 'Sample Size Calculated with Justification', completed: false },
      { id: 'p2-4', label: 'Statistical Test Selection Linked to Assumptions', completed: false },
    ];
  }
  return [
    { id: 'p3-1', label: 'Prompt Library Coverage Verified', completed: false },
    { id: 'p3-2', label: 'Error & Severity Catalog Approved', completed: false },
    { id: 'p3-3', label: 'Report Templates Exportable (PDF / Excel)', completed: false },
    { id: 'p3-4', label: 'RAG Spec & Developer Guide Delivered', completed: false },
  ];
};

export const listPhaseApprovals = (studyId: string): PhaseApproval[] => {
  const existing = getStore<PhaseApproval[]>(scopedKey(studyId, 'phases'), []);
  if (existing.length === 3) return existing;
  const defaults: PhaseApproval[] = [
    {
      studyId,
      phase: 1,
      title: 'Phase 1 — Knowledge Base & RAG Setup',
      description: 'Reference curation, indexing, metadata catalog, retrieval accuracy, and Reference Isolation guarantee.',
      status: 'not_submitted',
      deliverables: defaultPhaseDeliverables(1),
    },
    {
      studyId,
      phase: 2,
      title: 'Phase 2 — Clinical & Statistical Logic',
      description: 'Proposal assessment, CRF validation, Variable Mapping Matrix, Sample Size Engine, and Statistical Test Selection.',
      status: 'not_submitted',
      deliverables: defaultPhaseDeliverables(2),
    },
    {
      studyId,
      phase: 3,
      title: 'Phase 3 — Prompts & Integration',
      description: 'Prompt Library coverage, Error Catalog, Report Templates (PDF/Excel), RAG Specification, Developer Integration Guide.',
      status: 'not_submitted',
      deliverables: defaultPhaseDeliverables(3),
    },
  ];
  setStore(scopedKey(studyId, 'phases'), defaults);
  return defaults;
};

export const savePhaseApproval = (studyId: string, phase: PhaseApproval) => {
  const list = listPhaseApprovals(studyId);
  const idx = list.findIndex((p) => p.phase === phase.phase);
  if (idx < 0) {
    list.push(phase);
  } else {
    list[idx] = phase;
  }
  setStore(scopedKey(studyId, 'phases'), list);
  return phase;
};

export const togglePhaseDeliverable = (
  studyId: string,
  phaseNumber: 1 | 2 | 3,
  deliverableId: string,
  completed: boolean
) => {
  const list = listPhaseApprovals(studyId);
  const phase = list.find((p) => p.phase === phaseNumber);
  if (!phase) return null;
  phase.deliverables = phase.deliverables.map((d) => (d.id === deliverableId ? { ...d, completed } : d));
  setStore(scopedKey(studyId, 'phases'), list);
  return phase;
};

/* =================== App Notifications =================== */
const notificationsKey = (userId: string) => `user.${userId}.notifications`;

export const listNotifications = (userId: string): AppNotification[] =>
  getStore<AppNotification[]>(notificationsKey(userId), []);

export const pushNotification = (userId: string, n: Omit<AppNotification, 'id' | 'createdAt'>) => {
  return arrayAppend(notificationsKey(userId), {
    ...n,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  } as AppNotification, false);
};

export const markNotificationRead = (userId: string, id: string) => {
  const list = listNotifications(userId);
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) {
    list[idx].readAt = new Date().toISOString();
    setStore(notificationsKey(userId), list);
  }
  return list;
};

export const markAllNotificationsRead = (userId: string) => {
  const list = listNotifications(userId).map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }));
  setStore(notificationsKey(userId), list);
  return list;
};

/* =================== Audit Trail =================== */
export const listAuditLogs = (studyId: string): AuditLogEntry[] =>
  getStore<AuditLogEntry[]>(scopedKey(studyId, 'audit'), []);

export const appendAuditLog = (
  studyId: string,
  entry: Omit<AuditLogEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
) => {
  return arrayAppend(
    scopedKey(studyId, 'audit'),
    {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
    } as AuditLogEntry,
    false
  );
};

export const seedAuditIfEmpty = (studyId: string, userName: string, userId: string) => {
  const existing = listAuditLogs(studyId);
  if (existing.length > 0) return;
  const seeds: Omit<AuditLogEntry, 'id' | 'createdAt'>[] = [
    { actorUserId: userId, actorUserName: userName, action: 'study_created', details: { studyId } },
    { actorUserId: userId, actorUserName: userName, action: 'study_design_initialized', details: { hasRandomization: true, hasBlinding: true } },
    { actorUserId: userId, actorUserName: userName, action: 'outcome_template_auto_generated', details: { templateVersion: 1 } },
  ];
  seeds.forEach((s) => appendAuditLog(studyId, s));
};

/* =================== Error Catalog Static =================== */
export const ERROR_CATALOG: ErrorCatalogEntry[] = [
  {
    id: 'EC-001',
    code: 'M-RCT-001',
    shortMessage: 'Randomization method undefined for RCT',
    detailedMessage: 'Studies declared as randomized must explicitly define the randomization algorithm, block size, stratification factors, and allocation concealment mechanism.',
    category: 'methodological',
    severity: 'critical',
    suggestedCorrection: 'Go to Study Design and choose simple/block/stratified/cluster. Provide block size (if blocked) and concealment method (sequentially-numbered opaque sealed envelopes / central randomization).',
    supportingReferenceIds: ['CONSORT_2010', 'ICH_E9'],
    applicableStudyTypes: ['rct', 'cluster_rct'],
  },
  {
    id: 'EC-002',
    code: 'S-MULT-001',
    shortMessage: 'No multiplicity adjustment with >2 comparisons',
    detailedMessage: 'When more than one primary or confirmatory hypothesis is tested without adjustment, the familywise error rate (FWER) exceeds the pre-specified alpha.',
    category: 'statistical',
    severity: 'high',
    suggestedCorrection: 'Apply Bonferroni / Holm / Tukey HSD / Dunnett correction as appropriate. For co-primary endpoints, consider alpha-allocation (e.g., Pocock).',
    supportingReferenceIds: ['ICH_E9', 'BRETZ_MULTIPLE'],
    applicableStudyTypes: ['rct', 'prospective', 'retrospective'],
  },
  {
    id: 'EC-003',
    code: 'C-PD-001',
    shortMessage: 'Pocket Depth out of physiological range',
    detailedMessage: 'Probing pocket depth values above 15mm or below 0mm are physiologically impossible and indicate data entry or unit error.',
    category: 'clinical',
    severity: 'moderate',
    suggestedCorrection: 'Apply CRF field validation of PD ∈ [0, 15] mm. Reconcile data entry against source clinical chart.',
    supportingReferenceIds: ['AAP_PERIODONTAL'],
    applicableStudyTypes: ['*'],
  },
  {
    id: 'EC-004',
    code: 'MD-POL-001',
    shortMessage: 'Missing Data policy undocumented',
    detailedMessage: 'The protocol and SAP must pre-specify missing data classification, primary imputation strategy, and sensitivity analysis.',
    category: 'missing_data',
    severity: 'high',
    suggestedCorrection: 'Document MCAR/MAR/MNAR classification rules, primary imputation method (MICE recommended for MAR with ≥5% missing), and tipping-point / delta- adjustment sensitivity analyses.',
    supportingReferenceIds: ['ICH_E9_R1', 'NIH_MISSING_2023'],
    applicableStudyTypes: ['*'],
  },
  {
    id: 'EC-005',
    code: 'R-REF-001',
    shortMessage: 'Reference outside approved scope used',
    detailedMessage: 'A reference intended for In-Vitro ISO standards was cited in an RCT statistical methodology section.',
    category: 'reference_scope',
    severity: 'moderate',
    suggestedCorrection: 'Replace with a methodology reference in the correct study-scope category (e.g., CONSORT for RCTs, STROBE for observational).',
    supportingReferenceIds: ['EQUATOR_NETWORK'],
    applicableStudyTypes: ['*'],
  },
];
