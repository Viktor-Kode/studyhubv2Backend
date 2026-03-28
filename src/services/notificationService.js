import admin from '../config/firebase-admin.js';
import PushNotification from '../models/PushNotification.js';
import User from '../models/User.js';
import { sendEmail } from './emailService.js';
import { getEnv } from '../config/env.js';

const EMAIL_TYPES = ['payment_confirmed', 'plan_expiring', 'streak_ending', 'admin_announcement'];

const frontendBase = () => (getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app').replace(/\/+$/, '');

const getEmailContent = (type, data) => {
  const base = frontendBase();
  const templates = {
    payment_confirmed: {
      subject: '✅ Payment Confirmed — StudyHelp',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#5B4CF5">Payment Confirmed! 🎉</h2>
        <p>Your <strong>${data.plan}</strong> plan is now active.</p>
        <p>Valid until: <strong>${data.expiryDate}</strong></p>
        <a href="${base}/dashboard/student" style="display:inline-block;background:#5B4CF5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px">Go to Dashboard →</a>
      </div>`,
    },
    plan_expiring: {
      subject: '⚠️ Your StudyHelp plan expires tomorrow',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#F59E0B">Your plan expires tomorrow ⚠️</h2>
        <p>Your <strong>${data.plan}</strong> plan expires on <strong>${data.expiryDate}</strong>.</p>
        <p>Renew now to keep access to all features.</p>
        <a href="${base}/dashboard/upgrade" style="display:inline-block;background:#5B4CF5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px">Renew Plan →</a>
      </div>`,
    },
    streak_ending: {
      subject: '🔥 Your streak ends tonight — StudyHelp',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#EF4444">Don't break your streak! 🔥</h2>
        <p>You have a <strong>${data.streakDays}-day streak</strong> going. Study at least one topic today to keep it alive!</p>
        <a href="${base}/dashboard/student" style="display:inline-block;background:#5B4CF5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px">Study Now →</a>
      </div>`,
    },
    admin_announcement: {
      subject: `📢 ${data.title} — StudyHelp`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#5B4CF5">${data.title}</h2>
        <p>${data.body}</p>
        <a href="${base}/dashboard/student" style="display:inline-block;background:#5B4CF5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px">Go to StudyHelp →</a>
      </div>`,
    },
  };
  return templates[type] || null;
};

export const sendNotification = async ({
  userId,
  type,
  title,
  body,
  icon = '📚',
  link = '/dashboard/student',
  data = {},
}) => {
  try {
    await PushNotification.create({
      userId,
      type,
      title,
      body,
      icon,
      link,
      data,
      isRead: false,
    });

    const user = await User.findOne({ firebaseUid: userId });
    if (!user) return;

    if (user.fcmToken && user.notificationsEnabled) {
      try {
        const linkPath = link.startsWith('/') ? link : `/${link}`;
        const fullUrl = `${frontendBase()}${linkPath}`;

        await admin.messaging().send({
          token: user.fcmToken,
          notification: { title, body },
          webpush: {
            notification: {
              title,
              body,
              icon: '/android-chrome-192x192.png',
            },
            fcmOptions: { link: fullUrl },
          },
          data: {
            link: linkPath,
          },
        });
      } catch (fcmErr) {
        if (fcmErr.code === 'messaging/registration-token-not-registered' || fcmErr.code === 'messaging/invalid-registration-token') {
          await User.findOneAndUpdate({ firebaseUid: userId }, { fcmToken: null });
        }
        console.error('[FCM]', fcmErr.message);
      }
    }

    if (EMAIL_TYPES.includes(type) && user.email && !user.emailUnsubscribed) {
      const emailContent = getEmailContent(type, { ...data, userName: user.name });
      if (emailContent) {
        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
        });
      }
    }
  } catch (err) {
    console.error('[Notification Service]', err.message);
  }
};

export const sendBulkNotification = async ({ userIds, type, title, body, icon, link, data }) => {
  const batchSize = 20;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    await Promise.all(
      batch.map((userId) =>
        sendNotification({ userId, type, title, body, icon, link, data })
      )
    );
    await new Promise((r) => setTimeout(r, 300));
  }
};
