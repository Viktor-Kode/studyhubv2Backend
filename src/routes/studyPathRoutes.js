import express from 'express';
import multer from 'multer';
import {
  generateStudyPath,
  getActiveStudyPath,
  getUserStudyPaths,
  getStudyPathById,
  updateNodeStatus,
  deleteStudyPath,
  regenerateStudyPathNode
} from '../controllers/studyPathController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware to optionally extract user token without failing guests
const optionalProtect = (req, res, next) => {
  if (req.headers.authorization || (req.cookies && req.cookies.jwt)) {
    return protect(req, res, next);
  }
  next();
};

const uploadFields = upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'document', maxCount: 1 }
]);

// POST /api/generate-path (and /api/study-path)
router.post('/', optionalProtect, uploadFields, generateStudyPath);
router.post('/generate', optionalProtect, uploadFields, generateStudyPath);

// GET /api/generate-path/active or /api/study-path/active
router.get('/active', optionalProtect, getActiveStudyPath);
router.get('/all', optionalProtect, getUserStudyPaths);
router.get('/user/all', optionalProtect, getUserStudyPaths);

// GET & PUT & DELETE for specific path
router.get('/:topicId', optionalProtect, getStudyPathById);
router.put('/:topicId/node/:nodeId', optionalProtect, updateNodeStatus);
router.post('/:topicId/node/:nodeId/regenerate', optionalProtect, regenerateStudyPathNode);
router.delete('/:topicId', optionalProtect, deleteStudyPath);

export default router;
