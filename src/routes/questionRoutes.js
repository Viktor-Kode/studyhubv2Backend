import express from 'express';
import {
    getQuestions,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    generateAIQuestions
} from '../controllers/questionController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('teacher'));

router.get('/', getQuestions);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);
router.post('/generate-ai', checkAIUsage, generateAIQuestions);

export default router;
