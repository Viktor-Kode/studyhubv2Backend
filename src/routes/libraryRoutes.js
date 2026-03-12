import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfUpload } from '../config/pdfUpload.js';
import LibraryMaterial from '../models/LibraryMaterial.js';
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

// Proxy a single PDF through backend to avoid Cloudinary CORS issues
router.get('/proxy-pdf/:id', async (req, res) => {
  try {
    const material = await LibraryMaterial.findOne({
      _id: req.params.id,
      userId: req.user.uid,
    });

    if (!material) return res.status(404).json({ error: 'Not found' });

    const response = await fetch(material.fileUrl);

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch PDF' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[PDF Proxy]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;

