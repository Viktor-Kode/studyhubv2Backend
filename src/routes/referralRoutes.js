import express from 'express';
import { getReferralStats, validateReferralCode, applyReferral } from '../controllers/referralController.js';
import { protect } from '../middleware/authMiddleware.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiter specifically for referral endpoints to prevent abuse/brute forcing
const referralLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Limit each IP to 30 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 429,
        message: 'Too many referral attempts from this IP, please try again later.'
    }
});

// Apply rate limiting to all referral endpoints
router.use(referralLimiter);

// Public endpoint to validate a code prior to signup (UX preview helper)
router.get('/validate/:code', validateReferralCode);

// Protected endpoint to retrieve logged-in user's stats
router.get('/stats', protect, getReferralStats);

// Protected endpoint to apply a referral code (useful for all flows)
router.post('/apply', protect, applyReferral);

export default router;
