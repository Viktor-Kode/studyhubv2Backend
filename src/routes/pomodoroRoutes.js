import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    logPomodoroSession,
    getPomodoroStats,
    getPomodoroHistory,
} from '../controllers/pomodoroController.js';

const router = express.Router();
router.use(protect);

router.post('/log', logPomodoroSession);
router.get('/stats', getPomodoroStats);
router.get('/history', getPomodoroHistory);

export default router;
