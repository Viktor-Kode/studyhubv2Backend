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
  retryNodeController,
  claimStudyPathController
} from '../controllers/studyPathController.js';
import { protect } from '../middleware/authMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';
import StudyPath from '../models/StudyPath.js';

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

// Reading an already-generated challenge is free; only a cache miss spends
// an AI unit. Ownership is still checked by the controller.
const checkAIUsageOnChallengeMiss = async (req, res, next) => {
  try {
    const pathRecord = await StudyPath.findOne({ topicId: req.params.topicId })
      .select('challenge.questions challenge.stale');
    const hasCachedChallenge = Array.isArray(pathRecord?.challenge?.questions) &&
      pathRecord.challenge.questions.length >= 10 && !pathRecord.challenge.stale;
    if (hasCachedChallenge) return next();
    return checkAIUsage(req, res, next);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not check AI usage.' });
  }
};

// Middleware to optionally extract user token without failing guests
const optionalProtect = (req, res, next) => {
  if (req.headers.authorization || (req.cookies && req.cookies.jwt)) {
    return protect(req, res, next);
  }
  next();
};

const checkAIUsageIfAuthenticated = (req, res, next) => {
  if (!req.user?._id) return next();
  return checkAIUsage(req, res, next);
};

const checkAIUsageForNewClaim = async (req, res, next) => {
  try {
    const claimed = await StudyPath.findOne({
      claimedSessionId: req.body?.anonymousSessionId,
      userId: req.user?._id?.toString(),
      'claimState.usageCounted': true
    }).select('_id');
    if (claimed) return next();
    return checkAIUsage(req, res, next);
  } catch {
    return res.status(500).json({ success: false, message: 'Could not check AI usage.' });
  }
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
router.post('/claim', protect, checkAIUsageForNewClaim, claimStudyPathController);

// Challenge endpoints
router.get('/:topicId/challenge', protect, challengeLimiter, checkAIUsageOnChallengeMiss, getChallenge);
router.post('/:topicId/challenge', protect, challengeLimiter, checkAIUsageOnChallengeMiss, getChallenge);
router.post('/:topicId/challenge/submit', protect, submitChallenge);
router.post('/:topicId/challenge/retry', protect, challengeLimiter, checkAIUsage, retryChallenge);

// Progressive node streaming & rolling buffer endpoints
router.get('/:topicId/nodes/status', optionalProtect, getNodeStatusesController);
router.post('/:topicId/nodes/:nodeId/prepare', optionalProtect, prepareNodeController);
router.post('/:topicId/nodes/:nodeId/retry', optionalProtect, challengeLimiter, checkAIUsageIfAuthenticated, retryNodeController);

// GET & PUT & DELETE for specific path
router.get('/:topicId', optionalProtect, getStudyPathById);
router.put('/:topicId/node/:nodeId', optionalProtect, updateNodeStatus);
router.post('/:topicId/node/:nodeId/regenerate', protect, checkAIUsage, regenerateStudyPathNode);
router.post('/:topicId/node/:nodeId/analyze-summary', protect, checkAIUsage, analyzeLessonSummary);
router.delete('/:topicId', optionalProtect, deleteStudyPath);

export default router;
