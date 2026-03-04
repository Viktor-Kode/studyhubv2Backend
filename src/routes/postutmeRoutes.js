import express from 'express';
import {
  getUniversities,
  getUniversityBySlug,
  getPostUTMEQuestions,
  savePostUTMEResult,
  getPostUTMEResults,
  getPostUTMEResultById
} from '../controllers/postutmeController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/universities', getUniversities);
router.get('/universities/:slug', getUniversityBySlug);
router.get('/questions', getPostUTMEQuestions);
router.get('/results', protect, getPostUTMEResults);
router.get('/results/:id', protect, getPostUTMEResultById);
router.post('/results', protect, savePostUTMEResult);

export default router;
