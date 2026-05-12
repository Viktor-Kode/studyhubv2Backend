import express from 'express';
import {
    createStudyPlan,
    getActivePlan,
    updateTaskStatus,
    resetPlan
} from '../controllers/studyPlanController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.post('/', createStudyPlan);
router.get('/active', getActivePlan);
router.patch('/task', updateTaskStatus);
router.post('/reset', resetPlan);

export default router;
