import User from '../models/User.js';

/**
 * Server-side referral processing helper
 * Awards credits, increments counters, and associates users securely.
 */
export const processReferral = async (newUserId, refCode) => {
    // Find referrer by code
    const referrer = await User.findOne({ referralCode: refCode.toUpperCase() });

    // Edge case: invalid code
    if (!referrer) return { success: false, reason: 'Invalid referral code' };

    // Edge case: self-referral
    if (referrer._id.toString() === newUserId.toString()) {
        return { success: false, reason: 'Self-referral not allowed' };
    }

    // Edge case: already referred (duplicate check to prevent abuse)
    const alreadyReferred = referrer.referrals.find(
        r => r.userId && r.userId.toString() === newUserId.toString()
    );
    if (alreadyReferred) return { success: false, reason: 'Already referred' };

    // Award +20 AI credits to referrer and push new referral
    await User.findByIdAndUpdate(referrer._id, {
        $inc: { aiCredits: 20, referralCount: 1 },
        $push: { referrals: { userId: newUserId, rewarded: true } }
    });

    // Save referredBy on new user
    await User.findByIdAndUpdate(newUserId, {
        referredBy: referrer._id
    });

    return { success: true };
};

/**
 * GET /api/referral/stats
 * Returns the logged-in user's referral code, count, and credits earned
 */
export const getReferralStats = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id || req.user.id);
        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        const creditsEarned = user.referrals
            ? user.referrals.filter(r => r.rewarded).length * 20
            : 0;

        res.status(200).json({
            status: 'success',
            data: {
                referralCode: user.referralCode,
                referralCount: user.referralCount || 0,
                aiCredits: user.aiCredits || 0,
                creditsEarned
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/referral/validate/:code
 * Validates a referral code before signup (for frontend UI preview/UX)
 */
export const validateReferralCode = async (req, res, next) => {
    try {
        const { code } = req.params;
        if (!code) {
            return res.status(400).json({
                status: 'fail',
                message: 'Referral code is required'
            });
        }

        const referrer = await User.findOne({ referralCode: code.toUpperCase() });
        if (!referrer) {
            return res.status(404).json({
                status: 'fail',
                message: 'Invalid referral code'
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                isValid: true,
                referrerName: referrer.name
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/referral/apply
 * Applies a referral code to the logged-in user (useful for all signup flows including Firebase)
 */
export const applyReferral = async (req, res, next) => {
    try {
        const { refCode } = req.body;
        if (!refCode) {
            return res.status(400).json({
                status: 'fail',
                message: 'Referral code is required'
            });
        }

        const result = await processReferral(req.user._id || req.user.id, refCode);
        if (!result.success) {
            return res.status(400).json({
                status: 'fail',
                message: result.reason
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Referral applied successfully'
        });
    } catch (err) {
        next(err);
    }
};
