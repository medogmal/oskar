import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './auth.js';
import { getPhaseApprovalGate, type PhaseNumber } from '../models/Governance.js';
import { findStudyByIdForSupervisor, findStudyByIdForUser } from '../models/Study.js';

const ensureStudyPhaseGateAccess = async (req: AuthRequest, res: Response, studyId: string) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
    return false;
  }

  const { user } = req;
  if (user.accountType === 'student' || user.accountType === 'co_researcher') {
    const study = await findStudyByIdForUser(user.id, studyId);
    if (!study) {
      res.status(404).json({ message: 'Study not found' });
      return false;
    }
    return true;
  }

  const study = await findStudyByIdForSupervisor(studyId);
  if (!study) {
    res.status(404).json({ message: 'Study not found' });
    return false;
  }

  if (user.accountType === 'supervisor' && study.supervisorUserId === user.id) {
    return true;
  }

  if (user.accountType === 'assistant_supervisor' && study.assistantSupervisorUserId === user.id) {
    return true;
  }

  if (user.accountType === 'clinical_evaluator' && study.assignedClinicalEvaluatorUserId === user.id) {
    return true;
  }

  res.status(403).json({ message: 'This account cannot access the selected study workflow' });
  return false;
};

export const requireApprovedPriorPhases =
  (targetPhase: PhaseNumber, targetLabel: string) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const studyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!studyId) {
      return res.status(400).json({
        code: 'STUDY_ID_REQUIRED_FOR_PHASE_GATE',
        message: 'A study id is required to validate phase approval.',
      });
    }

    if (!(await ensureStudyPhaseGateAccess(req, res, studyId))) {
      return;
    }

    const gate = await getPhaseApprovalGate(studyId, targetPhase, targetLabel);
    if (!gate.allowed) {
      return res.status(409).json({
        code: 'PHASE_APPROVAL_REQUIRED',
        message: gate.message,
        gate,
      });
    }

    return next();
  };
