import express from 'express';
import { protect, restrictTo } from '../middleware/authMiddleware.js';
import {
    getClassAnalytics,
    getExamAnalytics,
    getStudentPerformance,
    getFullAnalytics
} from '../controllers/analyticsController.js';

const router = express.Router();

router.use(protect);

router.get('/class/:classId', restrictTo('teacher'), getClassAnalytics);
router.get('/exam/:examId', restrictTo('teacher'), getExamAnalytics);
router.get('/student/:id', restrictTo('teacher', 'student'), getStudentPerformance);
router.get('/full', restrictTo('student'), getFullAnalytics);

export default router;
