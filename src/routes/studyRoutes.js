import express from 'express';
import {
    createSession,
    getSessions,
    getStats,
    getActiveTimer,
    updateActiveTimer,
    deleteActiveTimer,
    getGoals,
    createGoal,
    deleteGoal
} from '../controllers/studyController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All study routes require authentication
router.use(protect);

// Logging and history
router.post('/log', createSession);
router.get('/history', getSessions);

// Analytics
router.get('/stats', getStats);

// Active Timer state
router.get('/active-timer', getActiveTimer);
router.post('/active-timer', updateActiveTimer);
router.delete('/active-timer', deleteActiveTimer);

// Goals
router.get('/goals', getGoals);
router.post('/goals', createGoal);
router.delete('/goals', deleteGoal);

export default router;
