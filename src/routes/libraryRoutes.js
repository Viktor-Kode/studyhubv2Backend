import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { pdfMemoryUpload } from '../config/pdfMemoryUpload.js';
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
  getDocumentUrl,
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
router.post('/documents', pdfMemoryUpload.single('file'), createDocument);
router.get('/documents/:id', getDocumentById);
// Returns just the Cloudinary URL — frontend loads PDF directly, bypassing the proxy
router.get('/documents/:id/url', getDocumentUrl);
router.put('/documents/:id', updateDocument);
router.delete('/documents/:id', deleteDocument);
router.get('/progress/:documentId', getProgress);
router.post('/progress', upsertProgress);
router.get('/recent', getRecentDocuments);

// Legacy proxy routes — kept for backwards compatibility but no longer called by the frontend.
// The frontend now loads PDFs directly from Cloudinary via the fileUrl stored on each document.
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

