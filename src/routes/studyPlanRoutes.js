import express from 'express';
import {
    createStudyPlan,
    getActivePlan,
    updateTaskStatus,
    autoCompleteTask,
    resetPlan
} from '../controllers/studyPlanController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', protect, getActivePlan);
router.post('/', protect, createStudyPlan);
router.post('/update-task', protect, updateTaskStatus);
router.post('/auto-complete', protect, autoCompleteTask);
router.post('/reset', protect, resetPlan);

export default router;
