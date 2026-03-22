import express from 'express';
import { getMyProgress, awardXPEndpoint, getLeaderboard } from '../controllers/progressController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', protect, getMyProgress);
router.post('/award', protect, awardXPEndpoint);
router.get('/leaderboard', protect, getLeaderboard);

export default router;
