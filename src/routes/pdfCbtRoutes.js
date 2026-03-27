import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfMemoryUpload } from '../config/pdfMemoryUpload.js';
import { extractQuestionsFromPDF } from '../controllers/pdfCbtController.js';

const router = express.Router();

router.post('/extract', protect, pdfMemoryUpload.single('pdf'), extractQuestionsFromPDF);

export default router;
