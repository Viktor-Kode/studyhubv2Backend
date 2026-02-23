import express from 'express';
import multer from 'multer';
import {
    uploadResource,
    getResources,
    deleteResource,
    generateQuestionsFromResource,
    generateFlashcardsFromResource,
    generateSummaryFromResource
} from '../controllers/resourceController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);
router.use(restrictTo('teacher'));

router.post('/upload', upload.single('file'), uploadResource);
router.get('/', getResources);
router.delete('/:id', deleteResource);
router.post('/:id/generate-questions', generateQuestionsFromResource);
router.post('/:id/generate-flashcards', generateFlashcardsFromResource);
router.post('/:id/generate-summary', generateSummaryFromResource);

export default router;
