import express from 'express';
import {
    signup,
    login,
    forgotPassword,
    resetPassword,
    getMe,
    updatePassword,
    updateMe
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/', signup);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

// Protected routes
router.get('/me', protect, getMe);
router.patch('/update-me', protect, updateMe);
router.post('/update-password', protect, updatePassword);

export default router;
