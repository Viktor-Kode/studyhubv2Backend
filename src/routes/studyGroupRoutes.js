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
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  listQuizzes,
  createQuiz,
  generateAiQuiz,
  answerQuiz,
  getWhiteboard,
  putWhiteboard,
} from '../controllers/studyGroupToolsController.js';

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
router.get('/:id/goals', protect, listGoals);
router.post('/:id/goals', protect, createGoal);
router.put('/:id/goals/:goalId', protect, updateGoal);
router.delete('/:id/goals/:goalId', protect, deleteGoal);
router.get('/:id/topics', protect, listTopics);
router.post('/:id/topics', protect, createTopic);
router.put('/:id/topics/:topicId', protect, updateTopic);
router.delete('/:id/topics/:topicId', protect, deleteTopic);
router.get('/:id/quizzes', protect, listQuizzes);
router.post('/:id/quizzes/ai', protect, generateAiQuiz);
router.post('/:id/quizzes', protect, createQuiz);
router.post('/:id/quizzes/:quizId/answer', protect, answerQuiz);
router.get('/:id/whiteboard', protect, getWhiteboard);
router.put('/:id/whiteboard', protect, putWhiteboard);
router.get('/:id/updates', protect, getGroupUpdates);
router.post('/:id/ask-ai', protect, askGroupAI);
router.get('/:id', protect, getStudyGroup);

export default router;
