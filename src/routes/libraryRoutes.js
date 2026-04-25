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
  listDocuments,
  createDocument,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getProgress,
  upsertProgress,
  getRecentDocuments,
  getUploadSignature,
  finalizeUpload,
  proxyLibraryPdf,
  proxyLibraryFile,
} from '../controllers/libraryController.js';

const router = express.Router();

router.use(protect);


// New robust direct upload routes
router.get('/upload-signature', getUploadSignature);
router.post('/finalize-upload', finalizeUpload);

// Library CRUD routes
router.get('/documents', listDocuments);
router.post('/documents', pdfUpload.single('file'), createDocument);
router.get('/documents/:id', getDocumentById);
router.put('/documents/:id', updateDocument);
router.delete('/documents/:id', deleteDocument);
router.get('/progress/:documentId', getProgress);
router.post('/progress', upsertProgress);
router.get('/recent', getRecentDocuments);

// PDF/File Proxy Routes (needed for Cloudinary assets that require signatures or have CORS issues)
router.get('/proxy-pdf/:id', proxyLibraryPdf);
router.get('/proxy-file/:id', proxyLibraryFile);

// Legacy endpoints kept for compatibility
router.get('/', getMaterials);
router.post('/upload', pdfUpload.single('pdf'), uploadMaterial);
router.put('/folder', manageFolder);
router.put('/:id/progress', saveProgress);
router.put('/:id', updateMaterial);
router.delete('/:id', deleteMaterial);

export default router;

