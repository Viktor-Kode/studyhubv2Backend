import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfUpload } from '../config/pdfUpload.js';
import {
  getMaterials,
  uploadMaterial,
  updateMaterial,
  deleteMaterial,
  saveProgress,
  manageFolder,
} from '../controllers/libraryController.js';

const router = express.Router();

router.use(protect);

router.get('/', getMaterials);
router.post('/upload', pdfUpload.single('pdf'), uploadMaterial);
router.put('/folder', manageFolder);
router.put('/:id', updateMaterial);
router.put('/:id/progress', saveProgress);
router.delete('/:id', deleteMaterial);

export default router;

