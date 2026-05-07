import User from '../models/User.js';
import AIRequestLog from '../models/AIRequestLog.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';
import { logPaywallEvent } from '../utils/paywallLogger.js';

// Check AI usage — runs before every AI endpoint
export const checkAIUsage = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id);
        if (!user) {
            return res.status(401).json({ error: 'User not found', message: 'User not found' });
        }
        user = await expireStaleActiveSubscription(user);

        // Determine how many AI units this request needs
        const requestedAmount = parseInt(req.body.amount || req.body.numberOfQuestions || req.body.count || 1) || 1;

        // Check subscription is active
        if (user.subscriptionStatus === 'expired') {
            return res.status(403).json({
                error: 'Subscription expired',
                message: 'Your plan has expired. Renew to continue.',
                showUpgrade: true,
                code: 'SUBSCRIPTION_EXPIRED'
            });
        }

        // Check AI limit - prevents bypassing by requesting large batches
        if (user.aiUsageCount + requestedAmount > user.aiUsageLimit) {
            await logPaywallEvent({
                userId: user._id,
                userEmail: user.email,
                action: 'AI_LIMIT_REACHED',
                context: {
                    used: user.aiUsageCount,
                    requested: requestedAmount,
                    limit: user.aiUsageLimit
                }
            });

            const remaining = Math.max(0, user.aiUsageLimit - user.aiUsageCount);

            return res.status(403).json({
                error: 'AI limit reached',
                message: user.subscriptionStatus === 'free'
                    ? (remaining > 0 
                        ? `You only have ${remaining} AI credits left, but this request needs ${requestedAmount}. Upgrade for more.`
                        : 'You have used up your free AI credits. Upgrade to a paid plan to continue.')
                    : `AI limit reached. You need ${requestedAmount} units but only have ${remaining} left. Purchase an add-on pack for ₦500.`,
                showUpgrade: true,
                used: user.aiUsageCount,
                requested: requestedAmount,
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
export const incrementAIUsage = async (userId, count = 1) => {
    const incAmount = parseInt(count) || 1;
    await User.findByIdAndUpdate(userId, {
        $inc: { aiUsageCount: incAmount }
    });

    // Log request for rate limiting (we still log 1 entry for the physical request)
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
        await logPaywallEvent({
            userId: user._id,
            userEmail: user.email,
            action: 'FLASHCARD_LIMIT_REACHED',
            context: {
                used: user.flashcardUsageCount,
                limit: user.flashcardUsageLimit
            }
        });

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

