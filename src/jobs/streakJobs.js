import cron from 'node-cron';
import Streak from '../models/Streak.js';

cron.schedule('59 23 * * *', async () => {
    console.log('[Streak] Running midnight streak check...');

    try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

        const allStreaks = await Streak.find({ currentStreak: { $gt: 0 } });
        let resetCount = 0;

        for (const streak of allStreaks) {
            const lastDate = (streak.lastActivityDate || streak.lastStudiedDate)
                ? new Date(streak.lastActivityDate || streak.lastStudiedDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
                : null;

            if (lastDate !== today) {
                streak.currentStreak = 0;
                streak.todayActivityCount = 0;
                streak.todayActivities = [];
                await streak.save();
                resetCount++;
            }
        }

        console.log(`[Streak] Midnight reset complete. Reset ${resetCount} streaks.`);
    } catch (err) {
        console.error('[Streak] Midnight reset error:', err.message);
    }
}, { timezone: 'Africa/Lagos' });

export default {};

cron.schedule('0 19 * * *', async () => {
    console.log('[Streak] Running 7pm daily reminder check...');
    try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
        const activeStreaks = await Streak.find({ currentStreak: { $gt: 0 } });
        
        const { sendNotification } = await import('../services/notificationService.js');
        const User = (await import('../models/User.js')).default;

        for (const streak of activeStreaks) {
            const lastDate = (streak.lastActivityDate || streak.lastStudiedDate)
                ? new Date(streak.lastActivityDate || streak.lastStudiedDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
                : null;

            if (lastDate !== today) {
                const user = await User.findById(streak.studentId).select('firebaseUid name webPushSubscription notificationsEnabled fcmToken');
                if (user && user.firebaseUid && (user.webPushSubscription || user.fcmToken) && user.notificationsEnabled) {
                    await sendNotification({
                        userId: user.firebaseUid,
                        type: 'daily_reminder',
                        title: 'Keep your streak alive!',
                        body: `Hey ${user.name}, practice for 10 minutes today 🔥`,
                        link: '/dashboard/student'
                    });
                }
            }
        }
    } catch (err) {
        console.error('[Streak] 7pm reminder error:', err.message);
    }
}, { timezone: 'Africa/Lagos' });
