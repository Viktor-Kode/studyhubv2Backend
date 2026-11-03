import express from 'express';
import { getStudyPathJobStatus } from '../controllers/studyPathController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
const optionalProtect = (req, res, next) => {
  if (req.headers.authorization || (req.cookies && req.cookies.jwt)) return protect(req, res, next);
  next();
};

router.get('/:jobId', optionalProtect, getStudyPathJobStatus);

export default router;
