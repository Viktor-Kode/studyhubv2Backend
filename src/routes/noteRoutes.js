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

const router = express.Router();

router.use(protect);

router.get('/', getNotes);
router.post('/', createNote);
router.put('/:id', updateNote);
router.delete('/:id', deleteNote);
router.put('/:id/pin', togglePin);
router.post('/from-ai', createNoteFromAI);

export default router;

