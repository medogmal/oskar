import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import {
  createStudy,
  evaluateStudyClinically,
  findStudyByIdForUser,
  findStudyByIdForSupervisor,
  lockStudyForExternalEvaluation,
  listPendingStudiesForClinicalEvaluator,
  listPendingStudiesForSupervisor,
  listStudiesByUser,
  resubmitStudy,
  reviewStudy,
  updateStudyDesign,
  type ClinicalEvaluationDecision,
  type ReviewDecision,
} from '../models/Study.js';
import { getVariableMatrixByStudy, saveVariableMatrixByStudy } from '../models/VariableMatrix.js';
import {
  GovernanceValidationError,
  PhaseApprovalError,
  getGovernanceByStudy,
  saveGovernanceByStudy,
} from '../models/Governance.js';
import {
  buildBlindingSettings,
  normalizeStudyGroups,
  type BlindedParty,
  type BlindingScope,
  type RandomizationMethod,
} from '../lib/studyDesign.js';
import { findUserByAcademicIdAndAccountType, findUserByIdAndAccountType } from '../models/User.js';

const ensureResearcher = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (!['student', 'co_researcher'].includes(req.user.accountType)) {
    res.status(403).json({ message: 'Only researcher accounts can manage studies' });
    return false;
  }

  return true;
};

const ensureSupervisor = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (!['supervisor', 'assistant_supervisor'].includes(req.user.accountType)) {
    res.status(403).json({ message: 'Only supervisor accounts can review studies' });
    return false;
  }

  return true;
};

const ensureClinicalEvaluator = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  if (req.user.accountType !== 'clinical_evaluator') {
    res.status(403).json({ message: 'Only clinical evaluator accounts can review study results' });
    return false;
  }

  return true;
};

const resolveGovernanceStudyAccess = async (req: AuthRequest, res: Response, studyId: string) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return null;
  }

  if (['student', 'co_researcher'].includes(req.user.accountType)) {
    const study = await findStudyByIdForUser(req.user.id, studyId);
    if (!study) {
      res.status(404).json({ message: 'Study not found' });
      return null;
    }
    return study;
  }

  const study = await findStudyByIdForSupervisor(studyId);
  if (!study) {
    res.status(404).json({ message: 'Study not found' });
    return null;
  }

  if (req.user.accountType === 'institution') {
    return study;
  }

  if (
    ['supervisor', 'assistant_supervisor'].includes(req.user.accountType) &&
    (study.supervisorUserId === req.user.id || study.assistantSupervisorUserId === req.user.id)
  ) {
    return study;
  }

  if (req.user.accountType === 'clinical_evaluator' && study.assignedClinicalEvaluatorUserId === req.user.id) {
    return study;
  }

  res.status(403).json({ message: 'This account cannot access governance data for the selected study' });
  return null;
};

const resolveStudyAccess = async (req: AuthRequest, res: Response, studyId: string) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return null;
  }

  if (['student', 'co_researcher'].includes(req.user.accountType)) {
    const study = await findStudyByIdForUser(req.user.id, studyId);
    if (!study) {
      res.status(404).json({ message: 'Study not found' });
      return null;
    }
    return study;
  }

  const study = await findStudyByIdForSupervisor(studyId);
  if (!study) {
    res.status(404).json({ message: 'Study not found' });
    return null;
  }

  if (req.user.accountType === 'institution') {
    return study;
  }

  if (
    ['supervisor', 'assistant_supervisor'].includes(req.user.accountType) &&
    (study.supervisorUserId === req.user.id || study.assistantSupervisorUserId === req.user.id)
  ) {
    return study;
  }

  if (req.user.accountType === 'clinical_evaluator' && study.assignedClinicalEvaluatorUserId === req.user.id) {
    return study;
  }

  res.status(403).json({ message: 'This account cannot access the selected study' });
  return null;
};

export const getStudies = async (req: AuthRequest, res: Response) => {
  if (!ensureResearcher(req, res)) {
    return;
  }

  const studies = await listStudiesByUser(req.user!.id);
  return res.json(studies);
};

export const getStudyById = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await resolveStudyAccess(req, res, studyId);
  if (!study) {
    return;
  }

  return res.json(study);
};

export const getStudyVariableMatrixRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await resolveStudyAccess(req, res, studyId);
  if (!study) {
    return;
  }

  const matrix = await getVariableMatrixByStudy(studyId);
  return res.json(matrix);
};

export const saveStudyVariableMatrixRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureResearcher(req, res)) {
    return;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await findStudyByIdForUser(req.user!.id, studyId);
  if (!study) {
    return res.status(404).json({ message: 'Study not found' });
  }

  const variables = Array.isArray(req.body.variables) ? req.body.variables : [];
  const matrix = await saveVariableMatrixByStudy(studyId, req.user!.id, variables);
  return res.json(matrix);
};

export const getStudyGovernanceRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await resolveGovernanceStudyAccess(req, res, studyId);
  if (!study) {
    return;
  }

  const snapshot = await getGovernanceByStudy(studyId);
  return res.json(snapshot);
};

export const saveStudyGovernanceRecord = async (req: AuthRequest, res: Response) => {
  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await resolveGovernanceStudyAccess(req, res, studyId);
  if (!study) {
    return;
  }

  try {
    const snapshot = await saveGovernanceByStudy(studyId, req.user!.id, req.body, req.user!.accountType);
    return res.json(snapshot);
  } catch (error) {
    if (error instanceof PhaseApprovalError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        gate: error.details,
      });
    }
    if (error instanceof GovernanceValidationError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }
};

export const createStudyRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureResearcher(req, res)) {
    return;
  }

  const coResearcherUserId =
    typeof req.body.coResearcherUserId === 'string' && req.body.coResearcherUserId.trim()
      ? req.body.coResearcherUserId.trim()
      : undefined;
  const supervisorUserId =
    typeof req.body.supervisorUserId === 'string' && req.body.supervisorUserId.trim()
      ? req.body.supervisorUserId.trim()
      : undefined;
  const assistantSupervisorUserId = undefined;
  const clinicalEvaluatorUserId = undefined;

  const resolvedCoResearcher =
    coResearcherUserId
      ? await findUserByIdAndAccountType(coResearcherUserId, 'co_researcher')
      : null;

  const resolvedAssistantSupervisor =
    assistantSupervisorUserId ? await findUserByIdAndAccountType(assistantSupervisorUserId, 'assistant_supervisor') : null;

  if (coResearcherUserId && !resolvedCoResearcher) {
    return res.status(400).json({ message: 'Selected co-researcher account is invalid' });
  }

  if (supervisorUserId) {
    const supervisor = await findUserByIdAndAccountType(supervisorUserId, 'supervisor');
    if (!supervisor) {
      return res.status(400).json({ message: 'Selected supervisor account is invalid' });
    }
  }

  if (assistantSupervisorUserId && !resolvedAssistantSupervisor) {
    return res.status(400).json({ message: 'Selected assistant supervisor account is invalid' });
  }

  const study = await createStudy({
    principalInvestigatorId: req.user!.id,
    title: req.body.title,
    studyType: req.body.studyType,
    workflowType: req.body.workflowType,
    targetSampleSize: Number(req.body.targetSampleSize || 0),
    hasRandomization: Boolean(req.body.hasRandomization),
    hasBlinding: Boolean(req.body.hasBlinding),
    randomizationMethod:
      typeof req.body.randomizationMethod === 'string' ? (req.body.randomizationMethod as RandomizationMethod) : undefined,
    groups: Array.isArray(req.body.groups) ? req.body.groups.map((item: unknown) => String(item)) : undefined,
    blindingSettings:
      req.body.hasBlinding
        ? buildBlindingSettings({
            studyTitle: req.body.title,
            groups: Array.isArray(req.body.groups) ? req.body.groups.map((item: unknown) => String(item)) : undefined,
            blindedParties: Array.isArray(req.body.blindedParties)
              ? (req.body.blindedParties as BlindedParty[])
              : undefined,
            scope: Array.isArray(req.body.blindingScope) ? (req.body.blindingScope as BlindingScope[]) : undefined,
            targetVariables: Array.isArray(req.body.blindingTargetVariables)
              ? req.body.blindingTargetVariables.map((item: unknown) => String(item))
              : undefined,
            protocolText:
              typeof req.body.blindingProtocolText === 'string' ? req.body.blindingProtocolText : undefined,
          })
        : undefined,
    protocolFileName: req.body.protocolFileName,
    ethicsApprovalNumber: req.body.ethicsApprovalNumber,
    clinicalRegistrationNumber: req.body.clinicalRegistrationNumber,
    requiresClinicalEvaluation: Boolean(req.body.requiresClinicalEvaluation),
    coResearcherUserId: resolvedCoResearcher?.id,
    supervisorUserId,
    assistantSupervisorUserId: resolvedAssistantSupervisor?.id,
    clinicalEvaluatorUserId,
  });

  return res.status(201).json(study);
};

export const updateStudyDesignRecord = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  if (!['student', 'co_researcher', 'supervisor', 'assistant_supervisor'].includes(req.user.accountType)) {
    return res.status(403).json({ message: 'This account cannot manage study design settings' });
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const existingStudy =
    req.user.accountType === 'student' || req.user.accountType === 'co_researcher'
      ? await findStudyByIdForUser(req.user.id, studyId)
      : null;

  if (existingStudy?.isLocked) {
    return res.status(409).json({ message: 'Study is locked for external evaluation and cannot be modified' });
  }

  const groups = normalizeStudyGroups(Array.isArray(req.body.groups) ? req.body.groups.map((item: unknown) => String(item)) : undefined);
  const hasRandomization = Boolean(req.body.hasRandomization);
  const hasBlinding = Boolean(req.body.hasBlinding);
  const coResearcherUserId =
    typeof req.body.coResearcherUserId === 'string' && req.body.coResearcherUserId.trim()
      ? req.body.coResearcherUserId.trim()
      : undefined;
  const assistantSupervisorUserId =
    typeof req.body.assistantSupervisorUserId === 'string' && req.body.assistantSupervisorUserId.trim()
      ? req.body.assistantSupervisorUserId.trim()
      : undefined;
  const clinicalEvaluatorUserId =
    typeof req.body.clinicalEvaluatorUserId === 'string' && req.body.clinicalEvaluatorUserId.trim()
      ? req.body.clinicalEvaluatorUserId.trim()
      : undefined;
  const requiresClinicalEvaluation =
    typeof req.body.requiresClinicalEvaluation === 'boolean' ? req.body.requiresClinicalEvaluation : false;

  if (coResearcherUserId) {
    const coResearcher = await findUserByIdAndAccountType(coResearcherUserId, 'co_researcher');
    if (!coResearcher) {
      return res.status(400).json({ message: 'Selected co-researcher account is invalid' });
    }
  }

  if (assistantSupervisorUserId) {
    const assistantSupervisor = await findUserByIdAndAccountType(assistantSupervisorUserId, 'assistant_supervisor');
    if (!assistantSupervisor) {
      return res.status(400).json({ message: 'Selected assistant supervisor account is invalid' });
    }
  }

  if (clinicalEvaluatorUserId) {
    const evaluator = await findUserByIdAndAccountType(clinicalEvaluatorUserId, 'clinical_evaluator');
    if (!evaluator) {
      return res.status(400).json({ message: 'Selected clinical evaluator account is invalid' });
    }
  }

  const study = await updateStudyDesign({
    studyId,
    actorUserId: req.user.id,
    groups,
    hasRandomization,
    randomizationMethod:
      typeof req.body.randomizationMethod === 'string' ? (req.body.randomizationMethod as RandomizationMethod) : undefined,
    hasBlinding,
    blindingSettings:
      hasBlinding
        ? buildBlindingSettings({
            studyTitle: typeof req.body.title === 'string' ? req.body.title : undefined,
            groups,
            blindedParties: Array.isArray(req.body.blindedParties)
              ? (req.body.blindedParties as BlindedParty[])
              : undefined,
            scope: Array.isArray(req.body.blindingScope) ? (req.body.blindingScope as BlindingScope[]) : undefined,
            targetVariables: Array.isArray(req.body.blindingTargetVariables)
              ? req.body.blindingTargetVariables.map((item: unknown) => String(item))
              : undefined,
            protocolText:
              typeof req.body.blindingProtocolText === 'string' ? req.body.blindingProtocolText : undefined,
          })
        : undefined,
    coResearcherUserId: coResearcherUserId ?? null,
    assistantSupervisorUserId: assistantSupervisorUserId ?? null,
    clinicalEvaluatorUserId: clinicalEvaluatorUserId ?? null,
    requiresClinicalEvaluation,
  });

  if (!study) {
    return res.status(404).json({ message: 'Study not found or not accessible' });
  }

  return res.json(study);
};

export const lockStudyRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureResearcher(req, res)) {
    return;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const currentStudy = await findStudyByIdForUser(req.user!.id, studyId);

  if (!currentStudy) {
    return res.status(404).json({ message: 'Study not found' });
  }

  if (currentStudy.isLocked) {
    return res.json(currentStudy);
  }

  const lockedStudy = await lockStudyForExternalEvaluation({
    studyId,
    actorUserId: req.user!.id,
  });

  if (!lockedStudy) {
    return res.status(404).json({ message: 'Study not found or not accessible' });
  }

  return res.json(lockedStudy);
};

export const getSupervisorReviewQueue = async (req: AuthRequest, res: Response) => {
  if (!ensureSupervisor(req, res)) {
    return;
  }

  const studies = await listPendingStudiesForSupervisor(req.user!.id);
  return res.json(studies);
};

export const reviewStudyRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureSupervisor(req, res)) {
    return;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const reviewedStudy = await reviewStudy(
    req.user!.id,
    studyId,
    req.body.decision as ReviewDecision,
    req.body.reviewNotes,
  );

  if (!reviewedStudy) {
    return res.status(404).json({ message: 'Pending supervised study not found' });
  }

  return res.json(reviewedStudy);
};

export const resubmitStudyRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureResearcher(req, res)) {
    return;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const study = await resubmitStudy(req.user!.id, studyId);

  if (!study) {
    return res.status(404).json({ message: 'Study is not eligible for resubmission' });
  }

  return res.json(study);
};

export const getClinicalEvaluationQueue = async (req: AuthRequest, res: Response) => {
  if (!ensureClinicalEvaluator(req, res)) {
    return;
  }

  const studies = await listPendingStudiesForClinicalEvaluator(req.user!.id);
  return res.json(studies);
};

export const evaluateStudyClinicallyRecord = async (req: AuthRequest, res: Response) => {
  if (!ensureClinicalEvaluator(req, res)) {
    return;
  }

  const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const evaluatedStudy = await evaluateStudyClinically(
    req.user!.id,
    studyId,
    req.body.decision as Exclude<ClinicalEvaluationDecision, 'pending'>,
    req.body.notes,
  );

  if (!evaluatedStudy) {
    return res.status(404).json({ message: 'Clinical evaluation study not found or not eligible' });
  }

  return res.json(evaluatedStudy);
};
