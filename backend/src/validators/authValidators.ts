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
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('governorate').trim().notEmpty().withMessage('Governorate is required'),
  body('dateOfBirth')
    .if(body('accountType').custom((value) => value !== 'institution'))
    .notEmpty()
    .withMessage('Date of birth is required')
    .bail()
    .isISO8601()
    .withMessage('Date of birth must be a valid date'),
  body('emailType')
    .if(
      body('accountType').custom((value) =>
        ['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator'].includes(value),
      ),
    )
    .isIn(emailTypes)
    .withMessage('Email type must be academic or personal'),
  body('university')
    .if(
      body('accountType').custom((value) =>
        ['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator'].includes(value),
      ),
    )
    .trim()
    .notEmpty()
    .withMessage('University is required'),
  body('college')
    .if(
      body('accountType').custom((value) =>
        ['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator'].includes(value),
      ),
    )
    .trim()
    .notEmpty()
    .withMessage('College is required'),
  body('specialization')
    .if(
      body('accountType').custom((value) =>
        ['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator'].includes(value),
      ),
    )
    .trim()
    .notEmpty()
    .withMessage('Specialization is required'),
  body('academicLevel')
    .if(body('accountType').custom((value) => value === 'student' || value === 'co_researcher'))
    .trim()
    .notEmpty()
    .withMessage('Academic level is required'),
  body('supervisorId')
    .optional({ values: 'falsy' })
    .trim()
    .isInt({ min: 1 })
    .withMessage('Supervisor selection is invalid'),
  body('academicId')
    .trim()
    .custom((value, { req }) => {
      const accountType = req.body.accountType;
      if (['co_researcher', 'assistant_supervisor', 'clinical_evaluator'].includes(accountType) && !String(value ?? '').trim()) {
        throw new Error('Academic ID is required for co-researchers, assistant supervisors, and assessors');
      }

      return true;
    }),
  body('academicRank')
    .if(
      body('accountType').custom((value) =>
        value === 'supervisor' || value === 'assistant_supervisor' || value === 'clinical_evaluator',
      ),
    )
    .trim()
    .notEmpty()
    .withMessage('Academic rank is required'),
  body('institutionType')
    .if(body('accountType').equals('institution'))
    .isIn(institutionTypes)
    .withMessage('Institution type is invalid'),
  body('authorizedContactName')
    .if(body('accountType').equals('institution'))
    .trim()
    .notEmpty()
    .withMessage('Authorized contact name is required'),
  body('jobTitle')
    .if(body('accountType').equals('institution'))
    .trim()
    .notEmpty()
    .withMessage('Job title is required'),
  body('directContactNumber')
    .if(body('accountType').equals('institution'))
    .trim()
    .notEmpty()
    .withMessage('Direct contact number is required'),
];

export const loginValidator = [
  body('email').trim().isEmail().withMessage('A valid email address is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const updateSubscriptionValidator = [
  body('planCode').trim().notEmpty().withMessage('Subscription plan code is required'),
  body('billingCycle').isIn(billingCycles).withMessage('Billing cycle must be monthly or yearly'),
];
