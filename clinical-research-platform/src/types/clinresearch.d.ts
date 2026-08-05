export type SeverityLevel = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export type ErrorCategory =
  | 'methodological'
  | 'statistical'
  | 'clinical'
  | 'missing_data'
  | 'regulatory'
  | 'crf_structural'
  | 'reference_scope';

export type MeasurementScale = 'nominal' | 'ordinal' | 'interval' | 'ratio' | 'binary' | 'count' | 'time_to_event';

export type VariableRole =
  | 'primary_outcome'
  | 'secondary_outcome'
  | 'independent'
  | 'dependent'
  | 'confounder'
  | 'covariate'
  | 'effect_modifier'
  | 'mediator'
  | 'baseline'
  | 'demographic'
  | 'identifier';

export type VariableSource =
  | 'patient_self_report'
  | 'clinical_examination'
  | 'medical_record'
  | 'laboratory'
  | 'imaging'
  | 'questionnaire'
  | 'physician_assessment'
  | 'study_device'
  | 'administrative';

export type PhaseNumber = 1 | 2 | 3;

export type PhaseApprovalStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'needs_revision';

export interface VariableMapping {
  id: string;
  studyId: string;
  fieldId?: string;
  label: string;
  definition: string;
  role: VariableRole;
  scale: MeasurementScale;
  source: VariableSource;
  measurementMethod: string;
  unit: string;
  linkedOutcomeIds: string[];
  linkedObjectiveIds?: string[];
  linkedResearchQuestionIds: string[];
  linkedReferenceIds: string[];
  recommendedStatisticalTest: string;
  responseType?: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
  required?: boolean;
  section?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchQuestion {
  id: string;
  studyId: string;
  text: string;
  type: 'primary' | 'secondary' | 'exploratory';
  framework?: 'PICO' | 'PICOS' | 'PECO' | 'SPIRIT';
  population?: string;
  intervention?: string;
  comparator?: string;
  outcome?: string;
  setting?: string;
  createdAt: string;
}

export interface StudyObjective {
  id: string;
  studyId: string;
  text: string;
  type: 'primary' | 'secondary' | 'tertiary';
  linkedResearchQuestionIds: string[];
  hypothesis?: string;
  createdAt: string;
}

export interface ErrorCatalogEntry {
  id: string;
  code: string;
  shortMessage: string;
  detailedMessage: string;
  category: ErrorCategory;
  severity: SeverityLevel;
  suggestedCorrection: string;
  supportingReferenceIds: string[];
  applicableStudyTypes: string[];
  regulationLinks?: string[];
}

export interface ValidationItem {
  id: string;
  studyId?: string;
  requestId?: string;
  fieldId?: string;
  errorCode?: string;
  errorEntry?: ErrorCatalogEntry;
  severity: SeverityLevel;
  category: ErrorCategory;
  status: 'open' | 'resolved' | 'dismissed' | 'pending';
  title: string;
  detail: string;
  suggestedAction?: string;
  location?: { section?: string; fieldLabel?: string; page?: number };
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface PhaseApproval {
  studyId: string;
  phase: PhaseNumber;
  title: string;
  description: string;
  status: PhaseApprovalStatus;
  submittedAt?: string;
  submittedBy?: string;
  submittedByName?: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedByName?: string;
  decisionNotes?: string;
  revisionRequests?: string;
  deliverables: Array<{
    id: string;
    label: string;
    completed: boolean;
    notes?: string;
  }>;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: 'phase_approval' | 'validation_issue' | 'assessment_request' | 'assessment_submitted' | 'comment' | 'system' | 'template_update';
  title: string;
  message: string;
  severity?: SeverityLevel;
  linkPath?: string;
  readAt?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  requestId?: string;
  sampleId?: string;
  entryId?: string;
  actorUserId?: string;
  actorUserName?: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DecisionTreeNode {
  id: string;
  question?: string;
  description?: string;
  branches?: Array<{
    label: string;
    value: string | boolean | number;
    nextNodeId: string;
  }>;
  result?: {
    label: string;
    value: string;
    justification: string;
    references: string[];
    assumptions: string[];
    alternatives: Array<{ label: string; whyRejected: string }>;
  };
}

export interface ReportTemplate {
  id: string;
  type:
    | 'proposal_review'
    | 'crf_review'
    | 'statistical_analysis'
    | 'sample_size'
    | 'errors_deficiencies'
    | 'scientific_justification'
    | 'final_supervisor';
  title: string;
  version: string;
  issuedAt: string;
  studyId: string;
  studyTitle: string;
  authorName: string;
  sections: Array<{
    id: string;
    heading: string;
    level: 1 | 2 | 3 | 4;
    body: string;
    highlights?: string[];
    references?: string[];
    tables?: Array<{
      caption: string;
      columns: string[];
      rows: Array<Array<string | number | boolean>>;
    }>;
  }>;
  references: Array<{ id: string; citationText: string }>;
}

export interface OutcomeTypeDetection {
  variableId: string;
  label: string;
  detectedType: MeasurementScale;
  confidence: number;
  evidence: string[];
  overridden?: boolean;
  userOverride?: MeasurementScale;
}

export interface MissingDataPattern {
  column: string;
  missingCount: number;
  missingPercentage: number;
  patternClassification: 'MCAR' | 'MAR' | 'MNAR';
  classificationConfidence: number;
  recommendedTreatment: string;
  recommendedTreatmentCode: 'complete_case' | 'mean' | 'median' | 'mode' | 'mice' | 'locf' | 'nocb' | 'sensitivity';
}
