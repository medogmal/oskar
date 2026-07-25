import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { comparePassword, createUser, findUserByAcademicId, findUserByAcademicIdAndAccountType, findUserByEmail, findUserById, findUserByIdAndAccountType, getInstitutionUserOverview, listOutcomeAssessors, listSubscriptionPlans, listUsersByAccountTypes, updateUserSubscription, type AccountType } from '../models/User.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getInstitutionStudyOverview } from '../models/Study.js';

const generateToken = (id: string) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: '30d'
  });
};

const allowedDirectoryAccountTypes: AccountType[] = [
  'student',
  'co_researcher',
  'supervisor',
  'assistant_supervisor',
  'clinical_evaluator',
  'institution',
];

const parseRequestedAccountTypes = (rawValue: unknown, allowedAccountTypes: AccountType[]) =>
  (typeof rawValue === 'string' ? rawValue : Array.isArray(rawValue) ? rawValue.join(',') : '')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is AccountType => allowedAccountTypes.includes(item as AccountType));

export const register = async (req: Request, res: Response) => {
  try {
    const {
      email,
      password,
      fullName,
      accountType,
      phone,
      dateOfBirth,
      country,
      governorate,
      emailType,
      university,
      college,
      institutionType,
      specialization,
      academicLevel,
      academicId,
      academicRank,
      supervisorId,
      authorizedContactName,
      jobTitle,
      directContactNumber
    } = req.body;

    const userExists = await findUserByEmail(email);
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    if (typeof academicId === 'string' && academicId.trim()) {
      const duplicateAcademicId = await findUserByAcademicId(academicId.trim());
      if (duplicateAcademicId) {
        return res.status(400).json({ message: 'Academic ID already exists' });
      }
    }

    if (
      ['student', 'co_researcher'].includes(accountType) &&
      typeof supervisorId === 'string' &&
      supervisorId.trim()
    ) {
      const linkedSupervisor = await findUserByIdAndAccountType(supervisorId.trim(), 'supervisor');
      if (!linkedSupervisor) {
        return res.status(400).json({ message: 'Selected supervisor account is invalid' });
      }
    }

    const user = await createUser({
      email,
      password,
      fullName,
      accountType,
      phone,
      dateOfBirth: accountType === 'institution' ? undefined : dateOfBirth,
      country,
      governorate,
      emailType,
      university,
      college,
      institutionType,
      specialization,
      academicLevel,
      academicId,
      academicRank,
      supervisorId,
      authorizedContactName,
      jobTitle,
      directContactNumber,
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    res.status(201).json({
      _id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      trialEndsAt: user.trialEndsAt,
      subscription: user.subscription,
      token: generateToken(String(user.id))
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);

    if (user && (await comparePassword(password, user.password))) {
      res.json({
        _id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        trialEndsAt: user.trialEndsAt,
        subscription: user.subscription,
        token: generateToken(String(user.id))
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getCurrentUser = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  return res.json(req.user);
};

export const getUserDirectory = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const accountTypes = parseRequestedAccountTypes(req.query.accountTypes, allowedDirectoryAccountTypes);

  const directory = await listUsersByAccountTypes(accountTypes.length > 0 ? accountTypes : allowedDirectoryAccountTypes);
  return res.json(directory);
};

export const getPublicUserDirectory = async (req: Request, res: Response) => {
  const allowedPublicAccountTypes: AccountType[] = ['supervisor', 'clinical_evaluator'];
  const accountTypes = parseRequestedAccountTypes(req.query.accountTypes, allowedPublicAccountTypes);

  const directory = await listUsersByAccountTypes(accountTypes.length > 0 ? accountTypes : allowedPublicAccountTypes);
  return res.json(directory);
};

export const getOutcomeAssessorDirectory = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const directory = await listOutcomeAssessors({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    specialization: typeof req.query.specialization === 'string' ? req.query.specialization : undefined,
    university: typeof req.query.university === 'string' ? req.query.university : undefined,
  });

  return res.json(directory);
};

export const getInstitutionOverview = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  if (req.user.accountType !== 'institution') {
    return res.status(403).json({ message: 'Only institution accounts can access institution overview' });
  }

  const [userOverview, studyOverview] = await Promise.all([
    getInstitutionUserOverview(),
    getInstitutionStudyOverview(),
  ]);

  return res.json({
    ...userOverview,
    ...studyOverview,
  });
};

export const getSubscriptionPlans = async (_req: Request, res: Response) => {
  const plans = await listSubscriptionPlans();
  return res.json(plans);
};

export const updateCurrentUserSubscription = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const planCode = typeof req.body.planCode === 'string' ? req.body.planCode : '';
  const billingCycle = req.body.billingCycle === 'yearly' ? 'yearly' : 'monthly';

  const updatedUser = await updateUserSubscription(req.user.id, {
    planCode,
    billingCycle,
  });

  if (!updatedUser) {
    return res.status(404).json({ message: 'Subscription plan not found' });
  }

  const freshUser = await findUserById(req.user.id);
  return res.json({
    message: 'Subscription updated successfully',
    user: freshUser ?? updatedUser,
  });
};
