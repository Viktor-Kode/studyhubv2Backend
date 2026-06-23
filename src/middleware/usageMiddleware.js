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
        const requestedAmount = parseInt(req.body.amount || req.body.numberOfQuestions || req.body.requestedCount || req.body.count || 1) || 1;

        // Check subscription is active
        if (user.subscriptionStatus === 'expired') {
            return res.status(403).json({
                error: 'Subscription expired',
                message: 'Your plan has expired. Renew to continue.',
                showUpgrade: true,
                code: 'SUBSCRIPTION_EXPIRED'
            });
        }

        // Check AI limit - prevents bypassing by requesting large batches (includes referral aiCredits)
        const totalLimit = user.aiUsageLimit + (user.aiCredits || 0);
        if (user.aiUsageCount + requestedAmount > totalLimit) {
            await logPaywallEvent({
                userId: user._id,
                userEmail: user.email,
                action: 'AI_LIMIT_REACHED',
                context: {
                    used: user.aiUsageCount,
                    requested: requestedAmount,
                    limit: totalLimit
                }
            });

            const remaining = Math.max(0, totalLimit - user.aiUsageCount);

            return res.status(403).json({
                error: 'AI limit reached',
                message: user.subscriptionStatus === 'free'
                    ? (remaining > 0 
                        ? `You only have ${remaining} AI credits left, but this request needs ${requestedAmount}. Upgrade for more.`
                        : 'You have used up your free and referral AI credits. Invite friends to get more, or upgrade to a paid plan.')
                    : `AI limit reached. You need ${requestedAmount} units but only have ${remaining} left. Purchase an add-on pack for ₦500.`,
                showUpgrade: true,
                used: user.aiUsageCount,
                requested: requestedAmount,
                limit: totalLimit,
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

// Check note creation usage
export const checkNoteUsage = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id);
        if (!user) {
            return res.status(401).json({ error: 'User not found', message: 'User not found' });
        }
        user = await expireStaleActiveSubscription(user);

        // Paid users and admins have unlimited notes
        if (user.subscriptionStatus === 'active' || user.role === 'admin') {
            req.currentUser = user;
            return next();
        }

        const limit = user.noteUsageLimit ?? 3;
        const used = user.noteUsageCount ?? 0;

        if (used >= limit) {
            await logPaywallEvent({
                userId: user._id,
                userEmail: user.email,
                action: 'NOTE_LIMIT_REACHED',
                context: { used, limit }
            });

            return res.status(403).json({
                error: 'Note limit reached',
                message: `You've used all ${limit} free notes. Upgrade to create unlimited notes.`,
                showUpgrade: true,
                used,
                limit,
                code: 'NOTE_LIMIT_REACHED'
            });
        }

        req.currentUser = user;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const incrementNoteUsage = async (userId) => {
    await User.findByIdAndUpdate(userId, {
        $inc: { noteUsageCount: 1 }
    });
};

// Check quiz session generation usage
export const checkQuizUsage = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id);
        if (!user) {
            return res.status(401).json({ error: 'User not found', message: 'User not found' });
        }
        user = await expireStaleActiveSubscription(user);

        // Paid users and admins have unlimited quiz generation
        if (user.subscriptionStatus === 'active' || user.role === 'admin') {
            req.currentUser = user;
            return next();
        }

        const limit = user.quizUsageLimit ?? 3;
        const used = user.quizUsageCount ?? 0;

        if (used >= limit) {
            await logPaywallEvent({
                userId: user._id,
                userEmail: user.email,
                action: 'QUIZ_LIMIT_REACHED',
                context: { used, limit }
            });

            return res.status(403).json({
                error: 'Quiz limit reached',
                message: `You've used all ${limit} free question sets. Upgrade to generate unlimited quizzes.`,
                showUpgrade: true,
                used,
                limit,
                code: 'QUIZ_LIMIT_REACHED'
            });
        }

        req.currentUser = user;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const incrementQuizUsage = async (userId) => {
    await User.findByIdAndUpdate(userId, {
        $inc: { quizUsageCount: 1 }
    });
};
