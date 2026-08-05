import { body } from 'express-validator';

const workflowTypes = ['supervised', 'migration'] as const;
const randomizationMethods = ['simple', 'block'] as const;
const blindedParties = ['participant', 'patient', 'researcher', 'supervisor', 'assessor', 'statistician'] as const;
const blindingScopes = ['material_type', 'treatment_procedure', 'split_mouth_side'] as const;
const reviewDecisions = ['approved', 'changes_requested', 'rejected'] as const;
const clinicalEvaluationDecisions = ['accepted', 'needs_revision', 'not_recommended'] as const;
const assessmentRequestActions = ['accept', 'reject'] as const;
const optionalUserId = (field: string, message: string) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .notEmpty()
    .withMessage(message);

const variableRoles = [
  'primary_outcome',
  'secondary_outcome',
  'independent',
  'dependent',
  'confounder',
  'covariate',
  'effect_modifier',
  'mediator',
  'baseline',
  'demographic',
  'identifier',
] as const;
const measurementScales = ['nominal', 'ordinal', 'interval', 'ratio', 'binary', 'count', 'time_to_event'] as const;
const variableSources = [
  'patient_self_report',
  'clinical_examination',
  'medical_record',
  'laboratory',
  'imaging',
  'questionnaire',
  'physician_assessment',
  'study_device',
  'administrative',
] as const;
const outcomeVariableRoles = ['primary_outcome', 'secondary_outcome', 'dependent'] as const;
const numericMeasurementScales = ['interval', 'ratio', 'count', 'time_to_event'] as const;

export const createStudyValidator = [
  body('title').trim().notEmpty().withMessage('Study title is required'),
  body('studyType').trim().notEmpty().withMessage('Study type is required'),
  body('workflowType')
    .isIn(workflowTypes)
    .withMessage('Workflow type must be supervised or migration'),
  body('targetSampleSize')
    .optional({ values: 'falsy' })
    .isInt({ min: 0 })
    .withMessage('Target sample size must be a positive integer'),
  body('description').optional({ values: 'falsy' }).trim(),
  body('protocolFileName').optional({ values: 'falsy' }).trim(),
  body('ethicsApprovalNumber').optional({ values: 'falsy' }).trim(),
  body('clinicalRegistrationNumber').optional({ values: 'falsy' }).trim(),
  body('hasRandomization').optional().isBoolean().withMessage('Randomization flag must be boolean'),
  body('randomizationMethod')
    .optional({ values: 'falsy' })
    .isIn(randomizationMethods)
    .withMessage('Randomization method must be simple or block'),
  body('groups').optional().isArray({ min: 1 }).withMessage('Study groups must be a non-empty array'),
  body('groups.*').optional().trim().notEmpty().withMessage('Study group label is required'),
  body('hasBlinding').optional().isBoolean().withMessage('Blinding flag must be boolean'),
  body('blindedParties').optional().isArray().withMessage('Blinded parties must be an array'),
  body('blindedParties.*').optional().isIn(blindedParties).withMessage('Blinded party selection is invalid'),
  body('blindingScope').optional().isArray().withMessage('Blinding scope must be an array'),
  body('blindingScope.*').optional().isIn(blindingScopes).withMessage('Blinding scope selection is invalid'),
  body('blindingTargetVariables').optional().isArray().withMessage('Blinding target variables must be an array'),
  body('blindingTargetVariables.*').optional().trim().notEmpty().withMessage('Blinding target variable is invalid'),
  body('blindingProtocolText').optional({ values: 'falsy' }).trim(),
  body('requiresClinicalEvaluation')
    .optional()
    .isBoolean()
    .withMessage('Clinical evaluation flag must be boolean'),
  optionalUserId('supervisorUserId', 'Supervisor selection is invalid'),
  body().custom((_, { req }) => {
    const workflowType = req.body.workflowType;
    const supervisorUserId = String(req.body.supervisorUserId ?? '').trim();

    if (workflowType === 'supervised' && !supervisorUserId) {
      throw new Error('A supervisor must be assigned for supervised studies');
    }

    return true;
  }),
];

export const updateStudyDesignValidator = [
  body('hasRandomization').isBoolean().withMessage('Randomization flag must be boolean'),
  body('randomizationMethod')
    .optional({ values: 'falsy' })
    .isIn(randomizationMethods)
    .withMessage('Randomization method must be simple or block'),
  body('hasBlinding').isBoolean().withMessage('Blinding flag must be boolean'),
  body('groups').isArray({ min: 1 }).withMessage('At least one study group is required'),
  body('groups.*').trim().notEmpty().withMessage('Study group label is required'),
  body('blindedParties').optional().isArray().withMessage('Blinded parties must be an array'),
  body('blindedParties.*').optional().isIn(blindedParties).withMessage('Blinded party selection is invalid'),
  body('blindingScope').optional().isArray().withMessage('Blinding scope must be an array'),
  body('blindingScope.*').optional().isIn(blindingScopes).withMessage('Blinding scope selection is invalid'),
  body('blindingTargetVariables').optional().isArray().withMessage('Blinding target variables must be an array'),
  body('blindingTargetVariables.*').optional().trim().notEmpty().withMessage('Blinding target variable is invalid'),
  body('blindingProtocolText').optional({ values: 'falsy' }).trim(),
  optionalUserId('coResearcherUserId', 'Co-researcher selection is invalid'),
  optionalUserId('assistantSupervisorUserId', 'Assistant supervisor selection is invalid'),
  optionalUserId('clinicalEvaluatorUserId', 'Clinical evaluator selection is invalid'),
  body('requiresClinicalEvaluation')
    .optional()
    .isBoolean()
    .withMessage('Clinical evaluation flag must be boolean'),
];

export const createOutcomeAssessmentRequestValidator = [
  body('assessmentType').trim().notEmpty().withMessage('Assessment type is required'),
  body('deadlineAt').optional({ values: 'falsy' }).isISO8601().withMessage('Assessment deadline is invalid'),
  body('samplesRequired')
    .optional({ values: 'falsy' })
    .isInt({ min: 0 })
    .withMessage('Samples required must be a positive integer'),
  body('assessorUserIds')
    .isArray({ min: 1, max: 3 })
    .withMessage('One to three assessors must be selected'),
  body('assessorUserIds.*')
    .isInt({ min: 1 })
    .withMessage('Assessor selection is invalid'),
  body('optionalMessage')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Assessment request message must be less than 2000 characters'),
];

export const upsertOutcomeAssessmentSamplesValidator = [
  body('samples').isArray({ min: 1 }).withMessage('At least one sample is required'),
  body('samples.*.subjectId').trim().notEmpty().withMessage('Subject ID is required'),
  body('samples.*.visitNumber').trim().notEmpty().withMessage('Visit number is required'),
  body('samples.*.inclusionEligible').optional().isBoolean().withMessage('Inclusion eligibility must be boolean'),
  body('samples.*.assetLinks').optional().isArray().withMessage('Asset links must be an array'),
  body('samples.*.assetLinks.*.fileId').optional().isInt({ min: 1 }).withMessage('Sample file reference is invalid'),
  body('samples.*.assetLinks.*.assetType')
    .optional()
    .isIn(['photo_before', 'photo_after', 'xray_before', 'xray_after', 'stl', 'lab_result', 'other'])
    .withMessage('Sample asset type is invalid'),
];

export const respondToOutcomeAssessmentRequestValidator = [
  body('action')
    .isIn(assessmentRequestActions)
    .withMessage('Assessment request action must be accept or reject'),
];

export const proposeOutcomeAssessmentTemplateValidator = [
  body('template').isArray({ min: 1 }).withMessage('Template items are required'),
  body('template.*.id').trim().notEmpty().withMessage('Template field ID is required'),
  body('template.*.label').trim().notEmpty().withMessage('Template field label is required'),
  body('template.*.responseType')
    .isIn(['numeric', 'choice', 'text', 'boolean'])
    .withMessage('Template response type is invalid'),
  body('template.*.options').optional().isArray().withMessage('Template options must be an array'),
  body('changeNotes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1500 })
    .withMessage('Template change notes must be less than 1500 characters'),
];

export const updateOutcomeAssessmentEntryValidator = [
  body('response').isObject().withMessage('Assessment response is required'),
  body('assessorComments')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Assessment comments must be less than 2000 characters'),
];

export const createOutcomeAssessmentNoteValidator = [
  body('message').trim().notEmpty().withMessage('Assessment note message is required'),
  body('sampleId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Sample selection is invalid'),
  body('recipientScope')
    .optional({ values: 'falsy' })
    .isIn(['research_team', 'assessor_only'])
    .withMessage('Recipient scope is invalid'),
];

export const reviewStudyValidator = [
  body('decision')
    .isIn(reviewDecisions)
    .withMessage('Review decision must be approved, changes_requested, or rejected'),
  body('reviewNotes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Review notes must be less than 1000 characters'),
  body('reviewNotes').custom((value, { req }) => {
    if ((req.body.decision === 'changes_requested' || req.body.decision === 'rejected') && !String(value ?? '').trim()) {
      throw new Error('Review notes are required when requesting changes or rejecting a study');
    }

    return true;
  }),
];

export const saveVariableMatrixValidator = [
  body('variables').isArray().withMessage('Variable matrix payload must be an array'),
  body('variables.*.id').trim().notEmpty().withMessage('Variable ID is required'),
  body('variables.*.label').trim().notEmpty().withMessage('Variable label is required'),
  body('variables.*.definition').trim().notEmpty().withMessage('Variable operational definition is required'),
  body('variables.*.role').isIn(variableRoles).withMessage('Variable role is invalid'),
  body('variables.*.scale').isIn(measurementScales).withMessage('Variable measurement scale is invalid'),
  body('variables.*.source').isIn(variableSources).withMessage('Variable source is invalid'),
  body('variables.*.measurementMethod').trim().notEmpty().withMessage('Measurement method is required'),
  body('variables.*.unit').optional().isString().withMessage('Unit must be text'),
  body('variables.*.linkedOutcomeIds').optional().isArray().withMessage('Outcome links must be an array'),
  body('variables.*.linkedObjectiveIds').optional().isArray().withMessage('Objective links must be an array'),
  body('variables.*.linkedResearchQuestionIds').optional().isArray().withMessage('Research question links must be an array'),
  body('variables.*.linkedReferenceIds').optional().isArray().withMessage('Reference links must be an array'),
  body('variables.*.recommendedStatisticalTest').optional().isString().withMessage('Recommended test must be text'),
  body('variables').custom((variables) => {
    if (!Array.isArray(variables)) {
      return true;
    }

    const normalizedLabels = new Map<string, string>();
    for (const variable of variables as Array<Record<string, unknown>>) {
      const label = String(variable.label ?? '').trim();
      const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9\u0621-\u064a]+/gi, '');
      if (normalizedLabel) {
        const existing = normalizedLabels.get(normalizedLabel);
        if (existing) {
          throw new Error(`Duplicate variable label detected: ${label} duplicates ${existing}`);
        }
        normalizedLabels.set(normalizedLabel, label);
      }

      const role = String(variable.role ?? '');
      const scale = String(variable.scale ?? '');
      const unit = String(variable.unit ?? '').trim();
      const recommendedTest = String(variable.recommendedStatisticalTest ?? '').trim();
      const linkedResearchQuestionIds = Array.isArray(variable.linkedResearchQuestionIds)
        ? variable.linkedResearchQuestionIds
        : [];
      const linkedObjectiveIds = Array.isArray(variable.linkedObjectiveIds) ? variable.linkedObjectiveIds : [];

      if (numericMeasurementScales.includes(scale as (typeof numericMeasurementScales)[number]) && !unit) {
        throw new Error(`Numeric/time variable "${label}" must include a measurement unit`);
      }

      if (outcomeVariableRoles.includes(role as (typeof outcomeVariableRoles)[number])) {
        if (linkedResearchQuestionIds.length === 0) {
          throw new Error(`Outcome variable "${label}" must link to at least one research question`);
        }
        if (linkedObjectiveIds.length === 0) {
          throw new Error(`Outcome variable "${label}" must link to at least one study objective`);
        }
        if (!recommendedTest) {
          throw new Error(`Outcome variable "${label}" must include a recommended statistical test`);
        }
      }
    }

    return true;
  }),
];

export const saveGovernanceValidator = [
  body('phases').isArray({ min: 1 }).withMessage('Governance phases payload must be an array'),
  body('phases.*.phase').isInt({ min: 1, max: 3 }).withMessage('Phase number must be between 1 and 3'),
  body('phases.*.title').trim().notEmpty().withMessage('Phase title is required'),
  body('phases.*.description').trim().notEmpty().withMessage('Phase description is required'),
  body('phases.*.status')
    .isIn(['not_submitted', 'pending', 'approved', 'rejected', 'needs_revision'])
    .withMessage('Phase status is invalid'),
  body('phases.*.deliverables').isArray().withMessage('Phase deliverables must be an array'),
  body('phases.*.deliverables.*.id').trim().notEmpty().withMessage('Deliverable ID is required'),
  body('phases.*.deliverables.*.label').trim().notEmpty().withMessage('Deliverable label is required'),
  body('phases.*.deliverables.*.completed').isBoolean().withMessage('Deliverable completion flag must be boolean'),
  body('auditLogs').optional().isArray().withMessage('Audit log payload must be an array'),
  body('notifications').optional().isArray().withMessage('Notification payload must be an array'),
];

export const clinicalEvaluationValidator = [
  body('decision')
    .isIn(clinicalEvaluationDecisions)
    .withMessage('Clinical evaluation decision must be accepted, needs_revision, or not_recommended'),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Clinical evaluation notes must be less than 1000 characters'),
  body('notes').custom((value, { req }) => {
    if ((req.body.decision === 'needs_revision' || req.body.decision === 'not_recommended') && !String(value ?? '').trim()) {
      throw new Error('Clinical evaluation notes are required when requesting a revision or not recommending the results');
    }

    return true;
  }),
];
