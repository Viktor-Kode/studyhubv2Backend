import express from 'express';
import {
  seedUniversities,
  addUniversity,
  updateUniversity,
  addQuestion,
  bulkImportQuestions,
  generateAIQuestions,
  validateQuestion
} from '../controllers/adminPostutmeController.js';

const router = express.Router();

router.post('/seed-universities', seedUniversities);
router.post('/universities', addUniversity);
router.put('/universities/:id', updateUniversity);
router.post('/questions', addQuestion);
router.post('/questions/bulk', bulkImportQuestions);
router.post('/questions/generate-ai', generateAIQuestions);
router.put('/questions/:id/validate', validateQuestion);

export default router;
