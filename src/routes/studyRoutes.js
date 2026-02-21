import express from 'express';
import {
    createSession,
    getSessions,
    getStats
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

export default router;
