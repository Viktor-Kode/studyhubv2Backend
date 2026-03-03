import cron from 'node-cron';
import User from '../models/User.js';
import Streak from '../models/Streak.js';
import { sendStreakReminder, sendGoalReminder, sendPlanExpiryWarning } from '../services/yCloudService.js';

let jobsRegistered = false;

export const registerNotificationJobs = () => {
    if (jobsRegistered) return;
    jobsRegistered = true;

    // Every day at 8:00 AM Nigeria time
    cron.schedule('0 8 * * *', async () => {
        console.log('🔔 Running daily notification jobs...');

        try {
            // 1. Streak reminders — users who studied yesterday but not today yet
            const atRiskUsers = await User.find({
                phoneNumber: { $exists: true, $ne: null },
            }).lean();

            for (const user of atRiskUsers) {
                try {
                    const streak = await Streak.findOne({ studentId: user._id });
                    if (streak && streak.currentStreak > 0) {
                        const lastStudied = new Date(streak.lastStudiedDate);
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        yesterday.setHours(0, 0, 0, 0);
                        lastStudied.setHours(0, 0, 0, 0);

                        // Only remind if last studied was yesterday (streak at risk)
                        if (lastStudied.getTime() === yesterday.getTime()) {
                            await sendStreakReminder(user.phoneNumber, {
                                streak: streak.currentStreak,
                                weakSubject: null
                            });
                            // Small delay to avoid rate limits
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                } catch (err) {
                    console.error(`[NotificationJob] Streak reminder failed for user ${user._id}:`, err.message);
                }
            }

            // 2. Plan expiry warnings — active subscriptions expiring in 2 days
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
