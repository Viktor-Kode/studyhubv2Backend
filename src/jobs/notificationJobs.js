import cron from 'node-cron';
import User from '../models/User.js';
import { sendPlanExpiryWarning } from '../services/termiiService.js';

let jobsRegistered = false;

export const registerNotificationJobs = () => {
    if (jobsRegistered) return;
    jobsRegistered = true;

    // Every day at 8:00 AM Nigeria time
    cron.schedule('0 8 * * *', async () => {
        console.log('🔔 Running daily notification jobs...');

        try {
            // Plan expiry warnings — active subscriptions expiring in 2 days
            const expiringUsers = await User.find({
                phoneNumber: { $exists: true, $ne: null },
                subscriptionStatus: 'active',
                subscriptionEnd: {
                    $gte: new Date(),
                    $lte: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
                }
            }).lean();

            for (const user of expiringUsers) {
                try {
                    const daysLeft = Math.ceil(
                        (new Date(user.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24)
                    );
                    await sendPlanExpiryWarning(user.phoneNumber, {
                        planName: user.subscriptionPlan || 'current',
                        daysLeft
                    });
                    await new Promise(r => setTimeout(r, 500));
                } catch (err) {
                    console.error(`[NotificationJob] Plan expiry warning failed for user ${user._id}:`, err.message);
                }
            }

            console.log('✅ Daily notifications sent');
        } catch (err) {
            console.error('❌ Notification job error:', err);
        }
    }, { timezone: 'Africa/Lagos' });

    console.log('📅 Notification cron jobs registered (8:00 AM WAT daily)');
};
