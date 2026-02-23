import express from 'express';
import { testALOCConnection, getQuestionsProxy } from '../controllers/cbtController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public health check for the specific service
router.get('/test', testALOCConnection);

// Protected proxy to fetch questions (matches frontend expectations)
router.get('/questions', protect, getQuestionsProxy);

export default router;
