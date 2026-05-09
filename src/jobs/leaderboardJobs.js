import cron from 'node-cron';
import User from '../models/User.js';
import { sendNotification } from '../services/notificationService.js';

// Run every day at 20:00 (8 PM)
cron.schedule('0 20 * * *', async () => {
    console.log('[Leaderboard] Running daily leaderboard check...');
    try {
        // Find the user with the most totalPoints
        const topUser = await User.findOne({ totalPoints: { $gt: 0 } })
            .sort({ totalPoints: -1 })
            .select('firebaseUid name webPushSubscription fcmToken notificationsEnabled')
            .lean();

        if (topUser && topUser.firebaseUid && topUser.notificationsEnabled && (topUser.webPushSubscription || topUser.fcmToken)) {
            await sendNotification({
                userId: topUser.firebaseUid,
                type: 'leaderboard_top',
                title: `🏆 You're #1 on the Leaderboard!`,
                body: `Amazing job, ${topUser.name}! You are currently the top student. Keep it up!`,
                link: '/dashboard/student/community'
            });
        }
    } catch (err) {
        console.error('[Leaderboard] Error checking top user:', err.message);
    }
}, { timezone: 'Africa/Lagos' });

export default {};
