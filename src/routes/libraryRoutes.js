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

// Proxy a single PDF through backend to avoid Cloudinary CORS issues
router.get('/proxy-pdf/:id', async (req, res) => {
  try {
    console.log('[PDF Proxy] Request for ID:', req.params.id);
    console.log('[PDF Proxy] User UID:', req.user?.uid);

    const material = await LibraryMaterial.findOne({
      _id: req.params.id,
      userId: req.user.uid,
    });

    console.log('[PDF Proxy] Material found:', material ? 'YES' : 'NO');
    console.log('[PDF Proxy] File URL:', material?.fileUrl);

    if (!material) return res.status(404).json({ error: 'Not found' });

    console.log('[PDF Proxy] Fetching from Cloudinary...');
    const response = await fetch(material.fileUrl);
    console.log('[PDF Proxy] Cloudinary response status:', response.status);

    if (!response.ok) {
      return res
        .status(502)
        .json({ error: `Cloudinary returned ${response.status}` });
    }

    const buffer = await response.arrayBuffer();
    console.log('[PDF Proxy] Buffer size:', buffer.byteLength);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[PDF Proxy] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Library CRUD routes
router.get('/', getMaterials);
router.post('/upload', pdfUpload.single('pdf'), uploadMaterial);
router.put('/folder', manageFolder);
router.put('/:id/progress', saveProgress);
router.put('/:id', updateMaterial);
router.delete('/:id', deleteMaterial);

export default router;

