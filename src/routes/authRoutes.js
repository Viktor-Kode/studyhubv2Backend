import express from 'express';
import {
    signup,
    login,
    forgotPassword,
    resetPassword,
    getMe,
    updatePassword,
    updateMe,
    updateUserPreferences,
    trackPwaUsage,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import {
    signupSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    updatePasswordSchema,
    updateMeSchema,
} from '../validators/authValidators.js';

const router = express.Router();

// Public routes
router.post('/', validate(signupSchema), signup);
router.post('/login', validate(loginSchema), login);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password/:token', validate(resetPasswordSchema), resetPassword);

// Protected routes
router.get('/me', protect, getMe);
router.patch('/preferences', protect, updateUserPreferences);
router.patch('/update-me', protect, validate(updateMeSchema), updateMe);
router.post('/update-password', protect, validate(updatePasswordSchema), updatePassword);
router.post('/pwa-usage', protect, trackPwaUsage);

export default router;

