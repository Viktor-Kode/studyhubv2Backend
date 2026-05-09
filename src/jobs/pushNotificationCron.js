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
          const firstName = user.name ? user.name.split(' ')[0] : 'there';
          const planName = user.subscriptionPlan || 'current';
          await sendNotification({
            userId: user.firebaseUid,
            type: 'plan_expiring',
            title: `⚠️ ${firstName}, your plan expires tomorrow!`,
            body: `Don't lose your study tools, ${firstName}. Renew your plan now!`,
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

          const user = await User.findById(s.studentId).select('name firebaseUid').lean();
          if (!user?.firebaseUid) continue;

          const firstName = user.name ? user.name.split(' ')[0] : 'there';
          await sendNotification({
            userId: user.firebaseUid,
            type: 'streak_ending',
            title: `🔥 ${firstName}, your ${s.currentStreak}-day streak ends tonight!`,
            body: 'Quick! Study for just 5 minutes to keep your progress alive.',
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

  // 7:00 AM Lagos — Morning Reminder (if not logged in)
  cron.schedule(
    '0 7 * * *',
    async () => {
      try {
        const today = getTodayLagos();
        const users = await User.find({ firebaseUid: { $exists: true, $ne: null } }).select('name firebaseUid _id').lean();
        
        let n = 0;
        for (const user of users) {
          const streak = await Streak.findOne({ studentId: user._id }).lean();
          const last = streak?.lastActivityDate || streak?.lastStudiedDate;
          const lastStr = last ? new Date(last).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : null;
          
          if (lastStr === today) continue;

          const firstName = user.name ? user.name.split(' ')[0] : 'there';
          await sendNotification({
            userId: user.firebaseUid,
            type: 'morning_reminder',
            title: `☀️ Good morning, ${firstName}!`,
            body: 'Ready to crush your study goals today? Let\'s get started! 📚',
            icon: '☀️',
            link: '/dashboard/student'
          });
          n++;
        }
        console.log(`[Cron] 7AM Morning reminders: ${n} users`);
      } catch (err) {
        console.error('[Cron] 7AM Morning reminder failed:', err.message);
      }
    },
    { timezone: 'Africa/Lagos' }
  );

  // 7:00 PM Lagos — Evening Reminder (if not logged in)
  cron.schedule(
    '0 19 * * *',
    async () => {
      try {
        const today = getTodayLagos();
        const users = await User.find({ firebaseUid: { $exists: true, $ne: null } }).select('name firebaseUid _id').lean();
        
        let n = 0;
        for (const user of users) {
          const streak = await Streak.findOne({ studentId: user._id }).lean();
          const last = streak?.lastActivityDate || streak?.lastStudiedDate;
          const lastStr = last ? new Date(last).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : null;
          
          if (lastStr === today) continue;

          const firstName = user.name ? user.name.split(' ')[0] : 'there';
          await sendNotification({
            userId: user.firebaseUid,
            type: 'evening_reminder',
            title: `🌙 Evening study, ${firstName}?`,
            body: 'Don\'t forget to review your topics before the day ends. You can do this! 💪',
            icon: '🌙',
            link: '/dashboard/student'
          });
          n++;
        }
        console.log(`[Cron] 7PM Evening reminders: ${n} users`);
      } catch (err) {
        console.error('[Cron] 7PM Evening reminder failed:', err.message);
      }
    },
    { timezone: 'Africa/Lagos' }
  );

  console.log('📅 Push notification crons registered (7AM/7PM reminders, 9AM expiry, 8PM streak — WAT)');
};
