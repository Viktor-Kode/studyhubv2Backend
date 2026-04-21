import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { sendEmail, reminderEmailTemplate } from '../services/emailService.js';
import { parseReminderWallClockToUtc } from '../utils/reminderTime.js';

// Run every minute to check due reminders and send Email messages
cron.schedule(
  '* * * * *',
  async () => {
    const now = new Date();

    try {
      // Fetch reminders that can send Email
      const reminders = await Reminder.find({
        completed: false,
        emailEnabled: true,
      }).lean();

      if (!reminders.length) return;

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
          const user = await User.findById(reminder.userId).select('email').lean();
          const to = user?.email;

          if (!to) continue;

          // 1) Send BEFORE reminder time (notifyBefore minutes)
          if (!reminder.emailBeforeNotifiedAt && now >= notifyTime && now < eventTime) {
            const html = reminderEmailTemplate({
              ...reminder,
              isNow: false
            });

            const subject = `Reminder: ${reminder.title || 'Upcoming task'}`;
            const result = await sendEmail({ to, subject, html });

            if (!result.success) {
              console.error(
                `[ReminderJobs] Failed to send BEFORE Email for reminder ${reminder._id}:`,
                result.error,
              );
            } else {
              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { emailBeforeNotifiedAt: new Date() } },
              );
            }
          }

          // 2) Send AT the reminder time
          if (!reminder.emailAtTimeNotifiedAt && now >= eventTime) {
            const html = reminderEmailTemplate({
              ...reminder,
              isNow: true
            });

            const subject = `StudyHelp Reminder: ${reminder.title || 'Task starting now'}`;
            const result = await sendEmail({ to, subject, html });

            if (!result.success) {
              console.error(
                `[ReminderJobs] Failed to send AT-TIME Email for reminder ${reminder._id}:`,
                result.error,
              );
            } else {
              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { emailAtTimeNotifiedAt: new Date() } },
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

