import express from 'express';
import {
    testALOCConnection,
    getQuestionsProxy,
    getAvailableSubjects,
    saveCBTResult,
    getCBTResultsSummary,
    getCBTResults,
    explainQuestion,
    generateTopicQuestions,
} from '../controllers/cbtController.js';
import { protect } from '../middleware/authMiddleware.js';
import { checkCBTAccess } from '../middleware/cbtMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';

const router = express.Router();

// Increase the Express route timeout for CBT endpoints
router.use((req, res, next) => {
    req.setTimeout(60000); // 60 seconds
    res.setTimeout(60000);
    next();
});

// Public: health check & metadata
router.get('/test', testALOCConnection);
router.get('/subjects', getAvailableSubjects);   // valid slugs, year range, exam types

// Protected: fetch questions & store results
router.get('/questions', protect, checkCBTAccess, getQuestionsProxy);
router.post('/results', protect, saveCBTResult);
router.get('/results', protect, getCBTResults);
router.get('/results/summary', protect, getCBTResultsSummary);
router.post('/explain', protect, checkAIUsage, explainQuestion);
router.post('/generate-topic-questions', protect, checkAIUsage, generateTopicQuestions);

export default router;
