import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createSharedNote,
    getMySharedNotes,
    getSharedWithMe,
    getSharedNoteById,
    updateSharedNote,
    deleteSharedNote,
    toggleSharedNotePublic,
    shareSharedNoteWithUser,
    likeSharedNote,
    searchSharedNotes,
    searchUsersForShare,
} from '../controllers/sharedNoteController.js';

const router = express.Router();
router.use(protect);

router.get('/mine', getMySharedNotes);
router.get('/with-me', getSharedWithMe);
router.get('/search', searchSharedNotes);
router.get('/users/search', searchUsersForShare);
router.post('/', createSharedNote);
router.get('/:id', getSharedNoteById);
router.put('/:id', updateSharedNote);
router.delete('/:id', deleteSharedNote);
router.patch('/:id/public', toggleSharedNotePublic);
router.post('/:id/share', shareSharedNoteWithUser);
router.post('/:id/like', likeSharedNote);

export default router;
