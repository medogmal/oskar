import { body } from 'express-validator';

const accountTypes = [
  'student',
  'co_researcher',
  'supervisor',
  'assistant_supervisor',
  'clinical_evaluator',
  'institution',
] as const;
const emailTypes = ['academic', 'personal'] as const;
const institutionTypes = ['university', 'hospital', 'research-center'] as const;
const billingCycles = ['monthly', 'yearly'] as const;

export const registerValidator = [
  body('email').trim().isEmail().withMessage('A valid email address is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('accountType')
    .isIn(accountTypes)
    .withMessage(
      'Account type must be student, co_researcher, supervisor, assistant_supervisor, clinical_evaluator, or institution',
    ),
  body('phone').optional({ values: 'falsy' }).trim(),
  body('country').optional({ values: 'falsy' }).trim(),
  body('governorate').optional({ values: 'falsy' }).trim(),
  body('dateOfBirth').optional({ values: 'falsy' }).isISO8601().withMessage('Date of birth must be a valid date'),
  body('emailType').optional({ values: 'falsy' }).isIn(emailTypes).withMessage('Email type must be academic or personal'),
  body('university').optional({ values: 'falsy' }).trim(),
  body('college').optional({ values: 'falsy' }).trim(),
  body('specialization').optional({ values: 'falsy' }).trim(),
  body('academicLevel').optional({ values: 'falsy' }).trim(),
  body('supervisorId').optional({ values: 'falsy' }).trim(),
  body('academicId').optional({ values: 'falsy' }).trim(),
  body('academicRank').optional({ values: 'falsy' }).trim(),
  body('institutionType').optional({ values: 'falsy' }).isIn(institutionTypes).withMessage('Institution type is invalid'),
  body('authorizedContactName').optional({ values: 'falsy' }).trim(),
  body('jobTitle').optional({ values: 'falsy' }).trim(),
  body('directContactNumber').optional({ values: 'falsy' }).trim(),
];

export const loginValidator = [
  body('email').trim().isEmail().withMessage('A valid email address is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const updateSubscriptionValidator = [
  body('planCode').trim().notEmpty().withMessage('Subscription plan code is required'),
  body('billingCycle').isIn(billingCycles).withMessage('Billing cycle must be monthly or yearly'),
];
