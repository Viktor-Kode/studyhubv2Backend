import express from 'express';
import { getStudents, getStudentPerformance } from '../controllers/studentController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('teacher'));

router.get('/', getStudents);
router.get('/:id/performance', getStudentPerformance);

export default router;
