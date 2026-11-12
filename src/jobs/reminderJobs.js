import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { sendEmail, reminderEmailTemplate } from '../services/emailService.js';
import { parseReminderWallClockToUtc } from '../utils/reminderTime.js';
import { sendNotification } from '../services/notificationService.js';

// Run every minute to check due reminders and send Email messages
cron.schedule(
  '* * * * *',
  async () => {
    const now = new Date();

    try {
      // Fetch reminders that can send Email
      const reminders = await Reminder.find({
        completed: false,
        $or: [
          { pushAtTimeNotifiedAt: null },
          { pushBeforeNotifiedAt: null },
          { emailEnabled: true, emailAtTimeNotifiedAt: null },
          { emailEnabled: true, emailBeforeNotifiedAt: null }
        ]
      }).lean();

      if (!reminders.length) return;

      const userIds = [...new Set(reminders.map((r) => r.userId).filter(Boolean))];
      const users = await User.find({ _id: { $in: userIds } })
        .select('email firebaseUid name webPushSubscription notificationsEnabled fcmToken')
        .lean();
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      for (const reminder of reminders) {
        try {
          const eventTime = parseReminderWallClockToUtc(reminder.date, reminder.time);
          if (!eventTime) {
            continue;
          }

          const notifyMinutes = reminder.notifyBefore ?? 15;
          const notifyTime = new Date(eventTime.getTime() - notifyMinutes * 60 * 1000);

          // Skip reminders that are far in the past (older than 1 day)
          const oneDayMs = 24 * 60 * 60 * 1000;
          if (now - eventTime > oneDayMs) {
            continue;
          }

          // Determine destination Email address
          const user = userMap.get(reminder.userId?.toString());
          const to = user?.email;

          // 1) Send BEFORE reminder time (notifyBefore minutes)
          if (now >= notifyTime && now < eventTime) {
            // A) EMAIL BEFORE (Via Resend)
            if (reminder.emailEnabled && !reminder.emailBeforeNotifiedAt) {
              const html = reminderEmailTemplate({ ...reminder, isNow: false });
              const subject = `Reminder: ${reminder.title || 'Upcoming task'}`;
              
              let result = { success: false, error: 'No email address' };
              if (to) {
                result = await sendEmail({ to, subject, html });
              } else {
                result = { success: true }; 
              }

              if (result.success) {
                await Reminder.updateOne(
                  { _id: reminder._id },
                  { $set: { emailBeforeNotifiedAt: new Date() } },
                );
              }
            }

            // B) PUSH BEFORE (Phone Notification)
            if (!reminder.pushBeforeNotifiedAt && user && (user.webPushSubscription || user.fcmToken) && user.notificationsEnabled) {
              await sendNotification({
                userId: user.firebaseUid || user._id.toString(),
                type: 'timetable_reminder',
                title: `Upcoming: ${reminder.title || 'Task'}`,
                body: `Starts in ${notifyMinutes} minutes!`,
                link: '/dashboard/timetable'
              });

              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { pushBeforeNotifiedAt: new Date() } },
              );
            }
          }

          // 2) Send AT the reminder time
          if (now >= eventTime) {
            // A) EMAIL AT TIME (Via Resend)
            if (reminder.emailEnabled && !reminder.emailAtTimeNotifiedAt) {
              const html = reminderEmailTemplate({ ...reminder, isNow: true });
              const subject = `StudyHelp Reminder: ${reminder.title || 'Task starting now'}`;
              
              let result = { success: false, error: 'No email address' };
              if (to) {
                result = await sendEmail({ to, subject, html });
              } else {
                result = { success: true };
              }

              if (result.success) {
                await Reminder.updateOne(
                  { _id: reminder._id },
                  { $set: { emailAtTimeNotifiedAt: new Date() } },
                );
              }
            }

            // B) PUSH AT TIME (Phone Notification)
            if (!reminder.pushAtTimeNotifiedAt && user && (user.webPushSubscription || user.fcmToken) && user.notificationsEnabled) {
              await sendNotification({
                userId: user.firebaseUid || user._id.toString(),
                type: 'timetable_reminder',
                title: `Time to study: ${reminder.title || 'Task'}`,
                body: `It's time! Let's get to work 💪`,
                link: '/dashboard/timetable'
              });

              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { pushAtTimeNotifiedAt: new Date() } },
              );
            }
          }
        } catch (err) {
          console.error('[ReminderJobs] Error processing reminder', reminder._id, err.message);
        }
      }
    } catch (err) {
      console.error('❌ Reminder job error:', err);
    }
  },
  { timezone: 'Africa/Lagos' },
);

console.log('⏰ Reminder Email cron job registered (every minute, Africa/Lagos)');

