import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    submitSharedLibraryItem,
    sharedLibraryUpload,
    getApprovedSharedLibrary,
    voteSharedLibrary,
    incrementSharedLibraryDownload,
    mySharedLibrarySubmissions,
} from '../controllers/sharedLibraryController.js';

const router = express.Router();

router.get('/items', protect, getApprovedSharedLibrary);
router.get('/mine', protect, mySharedLibrarySubmissions);
router.post('/submit', protect, sharedLibraryUpload.single('file'), submitSharedLibraryItem);
router.post('/:id/vote', protect, voteSharedLibrary);
router.post('/:id/download', protect, incrementSharedLibraryDownload);

export default router;
