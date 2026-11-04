import cron from 'node-cron';
import User from '../models/User.js';
import { sendNotification } from '../services/notificationService.js';
import { runRetentionNotificationTick } from '../services/retentionNotificationService.js';

let registered = false;
let retentionTickRunning = false;

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

  cron.schedule('*/15 * * * *', async () => {
    if (retentionTickRunning) return;
    retentionTickRunning = true;
    try {
      const result = await runRetentionNotificationTick();
      if (result.processed) console.log(`[Retention notifications] Evaluated ${result.processed} eligible users`);
    } catch (err) {
      console.error('[Retention notifications] Tick failed:', err.message);
    } finally {
      retentionTickRunning = false;
    }
  });

  console.log('📅 Notification crons registered (plan expiry + opt-in study reminders and weekly recap)');
};
