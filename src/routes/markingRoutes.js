import express from 'express';
import {
    getSubmission,
    markSubmission,
    aiSuggestMark,
    overrideMark
} from '../controllers/markingController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('teacher'));

router.get('/submissions/:id', getSubmission);
router.put('/submissions/:id/mark', markSubmission);
router.post('/submissions/:id/ai-suggest', checkAIUsage, aiSuggestMark);
router.put('/submissions/:id/override', overrideMark);

export default router;
