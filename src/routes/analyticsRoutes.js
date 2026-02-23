import express from 'express';
import {
    getClassAnalytics,
    getExamAnalytics,
    getStudentPerformance
} from '../controllers/analyticsController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/class/:classId', restrictTo('teacher'), getClassAnalytics);
router.get('/exam/:examId', restrictTo('teacher'), getExamAnalytics);
router.get('/student/:id', restrictTo('teacher', 'student'), getStudentPerformance);

export default router;
