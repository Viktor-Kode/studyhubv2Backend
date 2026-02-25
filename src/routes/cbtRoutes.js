import express from 'express';
import {
    testALOCConnection,
    getQuestionsProxy,
    getAvailableSubjects,
    saveCBTResult,
    getCBTResultsSummary,
    getCBTResults,
    explainQuestion,
} from '../controllers/cbtController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public: health check & metadata
router.get('/test', testALOCConnection);
router.get('/subjects', getAvailableSubjects);   // valid slugs, year range, exam types

// Protected: fetch questions & store results
router.get('/questions', protect, getQuestionsProxy);
router.post('/results', protect, saveCBTResult);
router.get('/results', protect, getCBTResults);
router.get('/results/summary', protect, getCBTResultsSummary);
router.post('/explain', protect, explainQuestion);

export default router;
