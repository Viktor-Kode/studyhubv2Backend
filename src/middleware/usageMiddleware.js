import User from '../models/User.js';
import AIRequestLog from '../models/AIRequestLog.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';

// Check AI usage — runs before every AI endpoint
export const checkAIUsage = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id);
        if (!user) {
            return res.status(401).json({ error: 'User not found', message: 'User not found' });
        }
        user = await expireStaleActiveSubscription(user);

        // Check subscription is active
        if (user.subscriptionStatus === 'expired') {
            return res.status(403).json({
                error: 'Subscription expired',
                message: 'Your plan has expired. Renew to continue.',
                showUpgrade: true,
                code: 'SUBSCRIPTION_EXPIRED'
            });
        }

        // Check AI limit
        if (user.aiUsageCount >= user.aiUsageLimit) {
            return res.status(403).json({
                error: 'AI limit reached',
                message: user.subscriptionStatus === 'free'
                    ? 'Upgrade to a paid plan for more AI messages.'
                    : 'AI limit reached. Purchase an add-on pack for ₦500.',
                showUpgrade: true,
                used: user.aiUsageCount,
                limit: user.aiUsageLimit,
                code: 'AI_LIMIT_REACHED'
            });
        }

        // Rate limiting — max 5 AI requests per minute per user
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const recentRequests = await AIRequestLog.countDocuments({
            userId: user._id,
            createdAt: { $gte: oneMinuteAgo }
        });

        if (recentRequests >= 5) {
            return res.status(429).json({
                error: 'Too many requests',
                message: 'Slow down! Max 5 AI requests per minute.',
                code: 'RATE_LIMITED'
            });
        }

        req.currentUser = user; // pass to controller if needed
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Call this AFTER successful AI response — increment usage
export const incrementAIUsage = async (userId) => {
    await User.findByIdAndUpdate(userId, {
        $inc: { aiUsageCount: 1 }
    });

    // Log request for rate limiting
    await AIRequestLog.create({ userId, createdAt: new Date() });
};

// Check flashcard generation usage
export const checkFlashcardUsage = async (req, res, next) => {
    let user = await User.findById(req.user.id);

    if (!user) {
        return res.status(401).json({ error: 'User not found', message: 'User not found' });
    }
    user = await expireStaleActiveSubscription(user);

    if (user.flashcardUsageCount >= user.flashcardUsageLimit) {
        return res.status(403).json({
            error: 'Flashcard generation limit reached',
            message: user.subscriptionStatus === 'free'
                ? 'Upgrade to generate more flashcard sets.'
                : 'Flashcard limit reached for this period.',
            showUpgrade: true,
            code: 'FLASHCARD_LIMIT_REACHED'
        });
    }

    req.currentUser = user;
    next();
};

export const incrementFlashcardUsage = async (userId) => {
    await User.findByIdAndUpdate(userId, {
        $inc: { flashcardUsageCount: 1 }
    });
};

