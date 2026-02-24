import express from 'express';
import {
    testALOCConnection,
    getQuestionsProxy,
    getAvailableSubjects,
} from '../controllers/cbtController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public: health check & metadata
router.get('/test', testALOCConnection);
router.get('/subjects', getAvailableSubjects);   // valid slugs, year range, exam types

// Protected: fetch questions
router.get('/questions', protect, getQuestionsProxy);

export default router;
