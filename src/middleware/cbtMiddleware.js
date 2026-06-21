import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';
import { logPaywallEvent } from '../utils/paywallLogger.js';

// CBT access middleware with subscription-aware logic
export const checkCBTAccess = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id).select(
            'subscriptionStatus subscriptionPlan subscriptionEnd plan'
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user = await expireStaleActiveSubscription(user);

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

        // Free/inactive users get limited CBT access
        if (!isActive) {
            const totalTests = await CBTResult.countDocuments({
                studentId: req.user.id
            });

            // Free users get 3 sessions total
            if (totalTests >= 3) {
                await logPaywallEvent({
                    userId: user._id,
                    userEmail: user.email,
                    action: 'CBT_LIMIT_REACHED',
                    context: { totalTests }
                });

                return res.status(403).json({
                    error: 'Upgrade Required',
                    message: 'Free plan is limited to 3 practice sessions. Upgrade to a paid plan for unlimited access.',
                    showUpgrade: true,
                    code: 'CBT_LIMIT_REACHED',
                    totalTests
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

