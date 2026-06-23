import express from 'express';
import {
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  createNoteFromAI
} from '../controllers/noteController.js';
import { protect } from '../middleware/authMiddleware.js';
import { checkNoteUsage } from '../middleware/usageMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getNotes);
router.post('/', checkNoteUsage, createNote);
router.put('/:id', updateNote);
router.delete('/:id', deleteNote);
router.put('/:id/pin', togglePin);
router.post('/from-ai', checkNoteUsage, createNoteFromAI);

export default router;
