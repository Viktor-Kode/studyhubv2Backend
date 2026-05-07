import express from 'express';
import multer from 'multer';
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
    chatWithTutor,
    generateQuestionsFromPDF,
    extractTextFromPDF,
    fetchUrlContent
} from '../controllers/aiController.js';
import { protect } from '../middleware/authMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All AI routes require authentication for user data isolation
router.use(protect);

// Generate study notes (POST) - counts as AI usage
router.post('/notes', checkAIUsage, generateNotes);
// Save a study note (POST)
router.post('/notes/save', saveStudyNote);
// Get all study notes (GET)
router.get('/notes', getStudyNotes);
// Delete a study note (DELETE)
router.delete('/notes/:id', deleteStudyNote);

// Generate a new quiz (POST)
router.post('/generate', checkAIUsage, generateQuiz);
// AI Tutor Chat (POST)
router.post('/chat', checkAIUsage, chatWithTutor);

// Fetch all individual questions (GET)
router.get('/questions', getQuestions);
// Delete an individual question (DELETE)
router.delete('/questions/:id', deleteQuestion);

// Generate questions from PDF (POST)
router.post('/generate-from-pdf', upload.single('pdf'), checkAIUsage, generateQuestionsFromPDF);

// Step 1 of Question Generation: Extract text from file
router.post('/extract', upload.single('pdf'), extractTextFromPDF);

// Fetch and extract content from a URL (POST)
router.post('/fetch-url', fetchUrlContent);

// Quiz Sessions (History grouped by quiz)
router.get('/sessions', getQuizSessions);
router.get('/sessions/:id', getQuizSession);
router.delete('/sessions/:id', deleteQuizSession);

export default router;