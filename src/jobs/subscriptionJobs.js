import cron from 'node-cron';
import User from '../models/User.js';
import { sendPlanExpiryWarning } from '../services/termiiService.js';

// Runs every day at midnight Nigeria time
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running subscription expiry check...');
    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const { sendNotification } = await import('../services/notificationService.js');

        // Find all expired active subscriptions
        const expired = await User.find({
            subscriptionStatus: 'active',
            subscriptionEnd: { $lt: now }
        });

        console.log(`Found ${expired.length} expired subscriptions`);

        for (const user of expired) {
            const planNameForNotify = user.subscriptionPlan || 'subscription';

            await User.findByIdAndUpdate(user._id, {
                subscriptionStatus: 'expired',
                subscriptionPlan: null,
                // Reset to free limits
                aiUsageCount: 0,
                aiUsageLimit: 3,
                flashcardUsageCount: 0,
                flashcardUsageLimit: 3,
                noteUsageCount: 0,
                noteUsageLimit: 3,
                quizUsageCount: 0,
                quizUsageLimit: 3,
            });

            console.log(`❌ Expired: ${user.email}`);

            if (user.phoneNumber) {
                await sendPlanExpiryWarning(user.phoneNumber, {
                    planName: planNameForNotify,
                    daysLeft: 0
                });
            }

            if (user.firebaseUid && (user.webPushSubscription || user.fcmToken) && user.notificationsEnabled) {
                await sendNotification({
                    userId: user.firebaseUid,
                    type: 'plan_expired',
                    title: `Your ${planNameForNotify} plan has expired`,
                    body: `Hey ${user.name}, renew now to keep your premium access!`,
                    link: '/dashboard/upgrade'
                });
            }
        }

        // Find subscriptions expiring tomorrow
        const expiringSoon = await User.find({
            subscriptionStatus: 'active',
            subscriptionEnd: { $gte: now, $lt: tomorrow }
        });

        for (const user of expiringSoon) {
            const planNameForNotify = user.subscriptionPlan || 'subscription';
            if (user.firebaseUid && (user.webPushSubscription || user.fcmToken) && user.notificationsEnabled) {
                await sendNotification({
                    userId: user.firebaseUid,
                    type: 'plan_expiring',
                    title: `Your ${planNameForNotify} plan expires tomorrow`,
                    body: `Hey ${user.name}, don't lose your premium features!`,
                    link: '/dashboard/upgrade'
                });
            }
        }

        console.log('✅ Expiry check complete');
    } catch (err) {
        console.error('❌ Expiry job error:', err.message);
    }
}, { timezone: 'Africa/Lagos' });

