import express from 'express';
import { getCurrentUser, getInstitutionOverview, getOutcomeAssessorDirectory, getPublicUserDirectory, getSubscriptionPlans, getUserDirectory, login, register, updateCurrentUserSubscription } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { loginValidator, registerValidator, updateSubscriptionValidator } from '../validators/authValidators.js';

const router = express.Router();

router.post('/register', registerValidator, validateRequest, register);
router.post('/login', loginValidator, validateRequest, login);
router.get('/subscription-plans', getSubscriptionPlans);
router.patch('/subscription', protect, updateSubscriptionValidator, validateRequest, updateCurrentUserSubscription);
router.get('/public-directory', getPublicUserDirectory);
router.get('/me', protect, getCurrentUser);
router.get('/directory', protect, getUserDirectory);
router.get('/outcome-assessors', protect, getOutcomeAssessorDirectory);
router.get('/institution-overview', protect, getInstitutionOverview);

export default router;
