import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getGroups,
  createGroup,
  joinGroup,
  leaveGroup,
  getStudyGroup,
  getMessages,
  sendMessage,
  toggleMessageReaction,
  getGroupUpdates,
  askGroupAI,
  editMessage,
  deleteMessage,
  markMessagesRead,
} from '../controllers/studyGroupController.js';

const router = express.Router();

router.get('/', protect, getGroups);
router.post('/', protect, createGroup);
router.post('/join', protect, joinGroup);
router.post('/:id/leave', protect, leaveGroup);
router.get('/:id/messages', protect, getMessages);
router.post('/:id/messages', protect, sendMessage);
router.patch('/:id/messages/:messageId/reactions', protect, toggleMessageReaction);
router.put('/:id/messages/:messageId', protect, editMessage);
router.delete('/:id/messages/:messageId', protect, deleteMessage);
router.post('/:id/mark-read', protect, markMessagesRead);
router.get('/:id/updates', protect, getGroupUpdates);
router.post('/:id/ask-ai', protect, askGroupAI);
router.get('/:id', protect, getStudyGroup);

export default router;
