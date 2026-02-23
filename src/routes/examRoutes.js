import express from 'express';
import {
    getExams,
    createExam,
    getExam,
    updateExam,
    deleteExam,
    publishExam,
    closeExam,
    getExamSubmissions
} from '../controllers/examController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('teacher'));

router.get('/', getExams);
router.post('/', createExam);
router.get('/:id', getExam);
router.put('/:id', updateExam);
router.delete('/:id', deleteExam);
router.post('/:id/publish', publishExam);
router.post('/:id/close', closeExam);
router.get('/:id/submissions', getExamSubmissions);

export default router;
