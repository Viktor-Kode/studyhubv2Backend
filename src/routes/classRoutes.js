import express from 'express';
import {
    getClasses,
    createClass,
    getClass,
    updateClass,
    deleteClass,
    joinClass,
    getClassStudents
} from '../controllers/classController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', restrictTo('teacher'), getClasses);
router.post('/', restrictTo('teacher'), createClass);
router.get('/:id', restrictTo('teacher'), getClass);
router.put('/:id', restrictTo('teacher'), updateClass);
router.delete('/:id', restrictTo('teacher'), deleteClass);

router.post('/join', restrictTo('student'), joinClass);
router.get('/:id/students', restrictTo('teacher'), getClassStudents);

export default router;
