import express from 'express';
import multer from 'multer';
import {
  generateStudyPath,
  getActiveStudyPath,
  getStudyPathById,
  updateNodeStatus
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

// GET & PUT for specific path
router.get('/:topicId', optionalProtect, getStudyPathById);
router.put('/:topicId/node/:nodeId', optionalProtect, updateNodeStatus);

export default router;
