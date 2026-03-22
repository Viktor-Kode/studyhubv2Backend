import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { sendWhatsAppText } from '../services/twilioService.js';
import { parseReminderWallClockToUtc } from '../utils/reminderTime.js';

// Run every minute to check due reminders and send WhatsApp messages
cron.schedule(
  '* * * * *',
  async () => {
    const now = new Date();

    try {
      // Fetch reminders that can send WhatsApp
      const reminders = await Reminder.find({
        completed: false,
        $or: [{ whatsappEnabled: true }, { sendWhatsApp: true }],
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

          // Determine destination WhatsApp number
          let to = reminder.whatsappNumber;
          if (!to) {
            const user = await User.findById(reminder.userId).select('phoneNumber phone').lean();
            to = user?.phone || user?.phoneNumber;
          }

          if (!to) continue;

          // Build common message body
          const baseLines = [
            reminder.title || 'Upcoming task',
            '',
            `Date: ${reminder.date}`,
            `Time: ${reminder.time}`,
          ];

          if (reminder.subject) baseLines.push(`Subject: ${reminder.subject}`);
          if (reminder.location) baseLines.push(`Location: ${reminder.location}`);
          if (reminder.description) {
            baseLines.push('', reminder.description);
          }

          baseLines.push('', 'studyhelp.com');

          // 1) Send BEFORE reminder time (notifyBefore minutes)
          if (!reminder.whatsappBeforeNotifiedAt && now >= notifyTime) {
            const beforeLines = [
              'StudyHelp Reminder (upcoming)',
              '',
              ...baseLines,
            ];

            const beforeBody = beforeLines.join('\n');
            const beforeResult = await sendWhatsAppText({ to, body: beforeBody });
            if (!beforeResult.success) {
              console.error(
                `[ReminderJobs] Failed to send BEFORE WhatsApp for reminder ${reminder._id}:`,
                beforeResult.error,
              );
            } else {
              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { whatsappBeforeNotifiedAt: new Date() } },
              );
            }
          }

          // 2) Send AT the reminder time
          if (!reminder.whatsappAtTimeNotifiedAt && now >= eventTime) {
            const atLines = [
              'StudyHelp Reminder (now)',
              '',
              ...baseLines,
            ];

            const atBody = atLines.join('\n');
            const atResult = await sendWhatsAppText({ to, body: atBody });
            if (!atResult.success) {
              console.error(
                `[ReminderJobs] Failed to send AT-TIME WhatsApp for reminder ${reminder._id}:`,
                atResult.error,
              );
            } else {
              await Reminder.updateOne(
                { _id: reminder._id },
                { $set: { whatsappAtTimeNotifiedAt: new Date() } },
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

console.log('⏰ Reminder WhatsApp cron job registered (every minute, Africa/Lagos)');

