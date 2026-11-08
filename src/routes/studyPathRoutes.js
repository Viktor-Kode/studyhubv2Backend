import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  generateStudyPath,
  getStudyPathJobStatus,
  getActiveStudyPath,
  getUserStudyPaths,
  getStudyMapCount,
  getStudyPathById,
  updateNodeStatus,
  deleteStudyPath,
  regenerateStudyPathNode,
  analyzeLessonSummary,
  getChallenge,
  submitChallenge,
  retryChallenge,
  generateStudyPathChallenge,
  getNodeStatusesController,
  prepareNodeController,
  retryNodeController
} from '../controllers/studyPathController.js';
import { protect } from '../middleware/authMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const challengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: 'Too many challenge requests. Please wait a short while before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false
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

// Poll a queued/background study path generation.
router.get('/jobs/:jobId', optionalProtect, getStudyPathJobStatus);

// GET /api/generate-path/active or /api/study-path/active
router.get('/active', optionalProtect, getActiveStudyPath);
router.get('/count', optionalProtect, getStudyMapCount);
router.get('/status', optionalProtect, getStudyMapCount);
router.get('/all', optionalProtect, getUserStudyPaths);
router.get('/user/all', optionalProtect, getUserStudyPaths);

// Challenge endpoints
router.get('/:topicId/challenge', optionalProtect, challengeLimiter, getChallenge);
router.post('/:topicId/challenge', optionalProtect, challengeLimiter, getChallenge);
router.post('/:topicId/challenge/submit', optionalProtect, submitChallenge);
router.post('/:topicId/challenge/retry', optionalProtect, challengeLimiter, retryChallenge);

// Progressive node streaming & rolling buffer endpoints
router.get('/:topicId/nodes/status', optionalProtect, getNodeStatusesController);
router.post('/:topicId/nodes/:nodeId/prepare', optionalProtect, prepareNodeController);
router.post('/:topicId/nodes/:nodeId/retry', optionalProtect, retryNodeController);

// GET & PUT & DELETE for specific path
router.get('/:topicId', optionalProtect, getStudyPathById);
router.put('/:topicId/node/:nodeId', optionalProtect, updateNodeStatus);
router.post('/:topicId/node/:nodeId/regenerate', optionalProtect, regenerateStudyPathNode);
router.post('/:topicId/node/:nodeId/analyze-summary', protect, checkAIUsage, analyzeLessonSummary);
router.delete('/:topicId', optionalProtect, deleteStudyPath);

export default router;
