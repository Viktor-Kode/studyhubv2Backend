import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfMemoryUpload } from '../config/pdfMemoryUpload.js';
import { extractQuestionsFromPDF, extractOnly, generateOnly } from '../controllers/pdfCbtController.js';

const router = express.Router();

router.post('/extract-debug', pdfMemoryUpload.single('pdf'), (req, res) => {
  res.json({
    hasFile: !!req.file,
    fileSize: req.file?.size || 0,
    mimetype: req.file?.mimetype || null,
    originalname: req.file?.originalname || null,
    bufferLength: req.file?.buffer?.length || 0,
    bodyKeys: Object.keys(req.body || {}),
    contentType: req.headers['content-type'],
    firstBytes: req.file?.buffer?.slice(0, 4)?.toString() || null,
  });
});

router.post('/extract', protect, pdfMemoryUpload.single('pdf'), extractOnly);
router.post('/generate', protect, generateOnly);

export default router;
