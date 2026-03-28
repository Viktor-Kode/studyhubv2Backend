import cron from 'node-cron';
import User from '../models/User.js';
import Streak from '../models/Streak.js';
import { sendNotification } from '../services/notificationService.js';

const getTodayLagos = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

let registered = false;

export const registerPushNotificationCrons = () => {
  if (registered) return;
  registered = true;

  // 9:00 AM Lagos — plans expiring tomorrow (calendar day UTC)
  cron.schedule(
    '0 9 * * *',
    async () => {
      console.log('[Cron] Checking expiring plans (push)...');
      try {
        const now = new Date();
        const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        const dayAfter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));

        const expiringUsers = await User.find({
          subscriptionStatus: 'active',
          subscriptionEnd: { $gte: tomorrow, $lt: dayAfter },
          firebaseUid: { $exists: true, $ne: null },
        }).lean();

        for (const user of expiringUsers) {
          const planName = user.subscriptionPlan || 'current';
          await sendNotification({
            userId: user.firebaseUid,
            type: 'plan_expiring',
            title: '⚠️ Your plan expires tomorrow!',
            body: 'Renew your plan to keep access to all features.',
            icon: '⚠️',
            link: '/dashboard/upgrade',
            data: {
              plan: planName,
              expiryDate: user.subscriptionEnd
                ? new Date(user.subscriptionEnd).toLocaleDateString('en-NG')
                : '',
            },
          });
        }
        console.log(`[Cron] Plan expiry push notifications: ${expiringUsers.length} users`);
      } catch (err) {
        console.error('[Cron] Expiry check failed:', err.message);
      }
    },
    { timezone: 'Africa/Lagos' }
  );

  // 8:00 PM Lagos — streak at risk (has streak, no activity today)
  cron.schedule(
    '0 20 * * *',
    async () => {
      try {
        const today = getTodayLagos();
        const streaks = await Streak.find({ currentStreak: { $gt: 0 } }).lean();

        let n = 0;
        for (const s of streaks) {
          const last = s.lastActivityDate || s.lastStudiedDate;
          const lastStr = last
            ? new Date(last).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
            : null;
          if (!lastStr || lastStr === today) continue;

          const user = await User.findById(s.studentId).select('firebaseUid').lean();
          if (!user?.firebaseUid) continue;

          await sendNotification({
            userId: user.firebaseUid,
            type: 'streak_ending',
            title: `🔥 Your ${s.currentStreak}-day streak ends tonight!`,
            body: 'Study something today to keep your streak alive.',
            icon: '🔥',
            link: '/dashboard/student',
            data: { streakDays: s.currentStreak },
          });
          n += 1;
        }
        console.log(`[Cron] Streak-at-risk push notifications: ${n} users`);
      } catch (err) {
        console.error('[Cron] Streak check failed:', err.message);
      }
    },
    { timezone: 'Africa/Lagos' }
  );

  console.log('📅 Push notification crons registered (9AM plan expiry, 8PM streak — WAT)');
};
