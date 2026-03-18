import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { sendWhatsAppText } from '../services/twilioService.js';

// Run every minute to check due reminders and send WhatsApp messages
cron.schedule(
  '* * * * *',
  async () => {
    const now = new Date();

    try {
      // Fetch reminders that can send WhatsApp and haven't been notified yet
      const reminders = await Reminder.find({
        completed: false,
        $or: [{ whatsappEnabled: true }, { sendWhatsApp: true }],
        whatsappNotifiedAt: { $exists: false },
      }).lean();

      if (!reminders.length) return;

      for (const reminder of reminders) {
        try {
          const [year, month, day] = (reminder.date || '').split('-').map(Number);
          const [hour, minute] = (reminder.time || '').split(':').map(Number);

          if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
            continue;
          }

          const eventTime = new Date();
          eventTime.setFullYear(year, month - 1, day);
          eventTime.setHours(hour, minute, 0, 0);

          const notifyMinutes = reminder.notifyBefore ?? 15;
          const notifyTime = new Date(eventTime.getTime() - notifyMinutes * 60 * 1000);

          // Trigger window: notifyTime <= now < notifyTime + 60s
          if (now < notifyTime || now - notifyTime > 60 * 1000) {
            continue;
          }

          // Determine destination WhatsApp number
          let to = reminder.whatsappNumber;
          if (!to) {
            const user = await User.findById(reminder.userId).select('phoneNumber phone').lean();
            to = user?.phone || user?.phoneNumber;
          }

          if (!to) continue;

          const bodyLines = [
            'StudyHelp Reminder',
            '',
            reminder.title || 'Upcoming task',
            '',
            `Date: ${reminder.date}`,
            `Time: ${reminder.time}`,
          ];

          if (reminder.subject) bodyLines.push(`Subject: ${reminder.subject}`);
          if (reminder.location) bodyLines.push(`Location: ${reminder.location}`);
          if (reminder.description) {
            bodyLines.push('', reminder.description);
          }

          bodyLines.push('', 'Good luck!', 'studyhelp.com');

          const body = bodyLines.join('\n');

          const result = await sendWhatsAppText({ to, body });
          if (!result.success) {
            console.error(
              `[ReminderJobs] Failed to send WhatsApp for reminder ${reminder._id}:`,
              result.error,
            );
            continue;
          }

          await Reminder.updateOne(
            { _id: reminder._id },
            { $set: { whatsappNotifiedAt: new Date() } },
          );
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

