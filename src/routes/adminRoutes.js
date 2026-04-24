import express from 'express';
import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';
import Transaction from '../models/Transaction.js';
import { PLANS } from '../config/plans.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';
import { adminAuth } from '../config/firebase-admin.js';
import {
    getAdminStats,
    getAdminUsers,
    getOnlineUsers,
    getTodayLogins,
    getDashboardLogins,
    getUserActivity,
    getUserActivityDay,
    getUserActivityDays,
    getMetricUsers,
    setUserVerification,
    grantPlan,
    deleteUser,
    getFullDashboardStats,
    getActivityFeed,
    adminQuickAction,
    exportUsersCSV,
    getPaywallEvents
} from '../controllers/adminController.js';
import {
    sendEmailCampaign,
    getEmailAudienceStats
} from '../controllers/emailCampaignController.js';
import {
    adminListPendingSharedLibrary,
    adminSetSharedLibraryStatus,
} from '../controllers/sharedLibraryController.js';
import { adminNotifyAll } from '../controllers/notificationController.js';

const router = express.Router();

// ─── Debug endpoints (no auth, temporary for debugging) ──────────────────────
router.get('/ping', (req, res) => {
    res.json({ success: true, message: 'Admin routes working' });
});

router.get('/debug-counts', async (req, res) => {
    try {
        const counts = {
            users: await User.countDocuments(),
            cbt: await CBTResult.countDocuments(),
            transactions: await Transaction.countDocuments(),
        };
        console.log('[Admin Debug] Counts:', counts);
        res.json({ success: true, counts });
    } catch (err) {
        console.error('[Admin Debug] Counts error:', err.message);
        res.json({ success: false, error: err.message });
    }
});

router.get('/check-claim/:email', async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const fbUser = await adminAuth.getUserByEmail(email);
        res.json({
            uid: fbUser.uid,
            customClaims: fbUser.customClaims || {},
            email: fbUser.email,
        });
    } catch (err) {
        console.error('[Admin Debug] Check claim error:', err.message);
        res.json({ error: err.message });
    }
});

// Dashboard routes — require Firebase auth + admin role
router.get('/stats', protect, restrictTo('admin'), getAdminStats);
router.get('/dashboard-stats', protect, restrictTo('admin'), getFullDashboardStats);
router.get('/activity-feed', protect, restrictTo('admin'), getActivityFeed);
router.post('/quick-action', protect, restrictTo('admin'), adminQuickAction);
router.get('/export-csv', protect, restrictTo('admin'), exportUsersCSV);
router.get('/users', protect, restrictTo('admin'), getAdminUsers);
router.get('/online-users', protect, restrictTo('admin'), getOnlineUsers);
router.get('/logins-today', protect, restrictTo('admin'), getTodayLogins);
router.get('/dashboard-logins', protect, restrictTo('admin'), getDashboardLogins);
router.get('/metric-users', protect, restrictTo('admin'), getMetricUsers);
router.get('/users/:id/activity-days', protect, restrictTo('admin'), getUserActivityDays);
router.get('/users/:id/activity/day', protect, restrictTo('admin'), getUserActivityDay);
router.get('/users/:id/activity', protect, restrictTo('admin'), getUserActivity);
router.patch('/users/:id/verify', protect, restrictTo('admin'), setUserVerification);
router.post('/users/:id/grant-plan', protect, restrictTo('admin'), grantPlan);
router.delete('/users/:id', protect, restrictTo('admin'), deleteUser);
router.get('/email-stats', protect, restrictTo('admin'), getEmailAudienceStats);
router.post('/email-campaign', protect, restrictTo('admin'), sendEmailCampaign);
router.post('/notify-all', protect, restrictTo('admin'), adminNotifyAll);
router.get('/shared-library/pending', protect, restrictTo('admin'), adminListPendingSharedLibrary);
router.patch('/shared-library/:id', protect, restrictTo('admin'), adminSetSharedLibraryStatus);
router.get('/paywall-events', protect, restrictTo('admin'), getPaywallEvents);

// POST /api/admin/fix-subscription
router.post('/fix-subscription', async (req, res) => {
    const { userId, plan, secretKey } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const planConfig = PLANS[plan];
        if (!planConfig) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const now = new Date();
        const newEnd = new Date(now);
        newEnd.setDate(newEnd.getDate() + planConfig.durationDays);

        const updated = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    subscriptionStatus: 'active',
                    subscriptionPlan: plan,
                    subscriptionStart: now,
                    subscriptionEnd: newEnd,
                    aiUsageCount: 0,
                    aiUsageLimit: planConfig.aiLimit,
                    flashcardUsageCount: 0,
                    flashcardUsageLimit: planConfig.flashcardLimit
                }
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            message: `✅ Manually activated ${plan} for user`,
            user: {
                email: updated.email,
                status: updated.subscriptionStatus,
                plan: updated.subscriptionPlan,
                end: updated.subscriptionEnd
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/migrate-subscriptions
router.post('/migrate-subscriptions', async (req, res) => {
    const { secretKey } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const users = await User.find({
        'plan.type': { $exists: true }
    });

    console.log(`Found ${users.length} users with old schema`);
    let migrated = 0;

    for (const user of users) {
        const oldPlan = user.plan?.type;
        const oldExpiry = user.plan?.expiresAt;

        if (!oldPlan || oldPlan === 'free') continue;

        const planMap = {
            starter: 'weekly',
            growth: 'monthly',
            premium: 'monthly',
            weekly: 'weekly',
            monthly: 'monthly'
        };

        const newPlan = planMap[oldPlan] || 'monthly';
        const planConfig = PLANS[newPlan];

        const now = new Date();
        const end = oldExpiry && new Date(oldExpiry) > now
            ? new Date(oldExpiry)
            : new Date(now.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000);

        await User.findByIdAndUpdate(user._id, {
            $set: {
                subscriptionStatus: 'active',
                subscriptionPlan: newPlan,
                subscriptionStart: user.plan?.createdAt || new Date(),
                subscriptionEnd: end,
                aiUsageCount: user.plan?.aiExplanationsUsed || 0,
                aiUsageLimit: planConfig.aiLimit,
                flashcardUsageCount: 0,
                flashcardUsageLimit: planConfig.flashcardLimit
            }
        });

        migrated++;
    }

    res.json({
        success: true,
        total: users.length,
        migrated,
        message: `✅ Migrated ${migrated} users to new subscription schema`
    });
});

export default router;

