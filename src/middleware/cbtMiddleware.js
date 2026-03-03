import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';

// CBT access middleware with subscription-aware logic
export const checkCBTAccess = async (req, res, next) => {
    try {
        // Always fetch fresh user from DB — never trust cached data
        const user = await User.findById(req.user.id).select(
            'subscriptionStatus subscriptionPlan subscriptionEnd plan'
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('🔍 CBT Access Check for', req.user.id, {
            subscriptionStatus: user.subscriptionStatus,
            subscriptionPlan: user.subscriptionPlan,
            subscriptionEnd: user.subscriptionEnd,
            now: new Date()
        });

        const now = new Date();

        // Check if subscription is active and not expired
        const isActive =
            user.subscriptionStatus === 'active' &&
            user.subscriptionEnd &&
            new Date(user.subscriptionEnd) > now;

        // Free/inactive users get limited CBT access — don't fully block them
        if (!isActive) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const todayTests = await CBTResult.countDocuments({
                studentId: req.user.id,
                takenAt: { $gte: today }
            });

            // Free users get 1 test per day
            if (todayTests >= 1) {
                return res.status(403).json({
                    error: 'Upgrade Required',
                    message: 'Free users get 1 CBT test per day. Upgrade for unlimited access.',
                    showUpgrade: true,
                    code: 'CBT_LIMIT_REACHED',
                    testsToday: todayTests
                });
            }
        }

        req.currentUser = user;
        req.isSubscribed = isActive;
        next();
    } catch (err) {
        console.error('❌ CBT access check error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

