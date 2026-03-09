import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getChatHistory,
  getChatSession,
  saveChatSession,
  deleteChatSession,
  clearAllChatHistory
} from '../controllers/chatHistoryController.js';

const router = express.Router();

// All chat history routes require authentication
router.use(protect);

router.get('/history', getChatHistory);
router.get('/history/:sessionId', getChatSession);
router.post('/history', saveChatSession);
router.delete('/history/all', clearAllChatHistory);
router.delete('/history/:sessionId', deleteChatSession);

export default router;

