import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfUpload } from '../config/pdfUpload.js';
import LibraryMaterial from '../models/LibraryMaterial.js';
import cloudinary from '../config/cloudinary.js';
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
    console.log('[PDF Proxy] User Mongo ID:', req.user?._id);

    const material = await LibraryMaterial.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!material) return res.status(404).json({ error: 'Not found' });

    console.log('[PDF Proxy] Material found:', material ? 'YES' : 'NO');
    console.log('[PDF Proxy] Stored URL:', material.fileUrl);

    // Try the stored URL first
    console.log('[PDF Proxy] Fetching stored URL...');
    let response = await fetch(material.fileUrl);
    console.log('[PDF Proxy] Status (stored):', response.status);

    // If 404, try raw → image
    if (!response.ok && material.fileUrl.includes('/raw/upload/')) {
      const altUrl = material.fileUrl.replace('/raw/upload/', '/image/upload/');
      console.log('[PDF Proxy] Trying alt URL (raw→image):', altUrl);
      response = await fetch(altUrl);
      console.log('[PDF Proxy] Status (raw→image):', response.status);
    }

    // If still not ok, try image → raw
    if (!response.ok && material.fileUrl.includes('/image/upload/')) {
      const altUrl = material.fileUrl.replace('/image/upload/', '/raw/upload/');
      console.log('[PDF Proxy] Trying alt URL (image→raw):', altUrl);
      response = await fetch(altUrl);
      console.log('[PDF Proxy] Status (image→raw):', response.status);
    }

    // If still failing and we have a publicId, fall back to signed URL for authenticated resources
    if (!response.ok && material.publicId) {
      try {
        console.log('[PDF Proxy] All direct URL variants failed, trying signed Cloudinary URL...');
        const signedUrl = cloudinary.url(material.publicId, {
          resource_type: 'raw',
          secure: true,
          sign_url: true,
        });
        console.log('[PDF Proxy] Signed URL:', signedUrl);
        response = await fetch(signedUrl);
        console.log('[PDF Proxy] Status (signed):', response.status);
      } catch (signErr) {
        console.error('[PDF Proxy] Failed to generate/fetch signed URL:', signErr.message);
      }
    }

    if (!response.ok) {
      console.error('[PDF Proxy] All URL attempts failed. Final status:', response.status);

      // If Cloudinary explicitly returns 404, surface that as a 404 to the client
      if (response.status === 404) {
        return res.status(404).json({
          error: 'PDF file not found on Cloudinary (404)',
        });
      }

      // For other status codes, keep using a 502 but include the upstream status
      return res.status(502).json({
        error: `Cloudinary returned ${response.status}`,
      });
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

