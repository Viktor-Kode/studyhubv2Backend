import express from 'express';
import {
    generateQuiz,
    generateNotes,
    saveStudyNote,
    getStudyNotes,
    deleteStudyNote,
    getQuestions,
    getQuizSessions,
    getQuizSession,
    deleteQuizSession,
    deleteQuestion,
    chatWithTutor
} from '../controllers/aiController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All AI routes require authentication for user data isolation
router.use(protect);

// Generate study notes (POST)
router.post('/notes', generateNotes);
// Save a study note (POST)
router.post('/notes/save', saveStudyNote);
// Get all study notes (GET)
router.get('/notes', getStudyNotes);
// Delete a study note (DELETE)
router.delete('/notes/:id', deleteStudyNote);

// Generate a new quiz (POST)
router.post('/generate', generateQuiz);
// AI Tutor Chat (POST)
router.post('/chat', chatWithTutor);

// Fetch all individual questions (GET)
router.get('/questions', getQuestions);
// Delete an individual question (DELETE)
router.delete('/questions/:id', deleteQuestion);

// Quiz Sessions (History grouped by quiz)
router.get('/sessions', getQuizSessions);
router.get('/sessions/:id', getQuizSession);
router.delete('/sessions/:id', deleteQuizSession);

export default router;