import admin from '../config/firebase-admin.js';
import PushNotification from '../models/PushNotification.js';
import User from '../models/User.js';
import { sendEmail } from './emailService.js';
import { getEnv } from '../config/env.js';
import webpush from 'web-push';

try {
  webpush.setVapidDetails(
    'mailto:support@studyhelp.com',
    getEnv('VAPID_PUBLIC_KEY') || 'BDwY_XTd827IvdnV3MbcuUosDltKcM4WSea2jxhVubX3xA8nnd8H4clSyRCFEZ5rXKVvSSxIFIdA7AKB7zaU9hE',
    getEnv('VAPID_PRIVATE_KEY') || 'm3tu1aef4R9Q8Q73m_zoI4iQ2so7wg2_fmwmDhfrROU'
  );
} catch (e) {
  console.error('[WebPush] Failed to set vapid details:', e.message);
}

const EMAIL_TYPES = ['payment_confirmed', 'plan_expiring', 'streak_ending', 'admin_announcement', 'welcome'];

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
    welcome: {
      subject: 'You just made a smart move 🎯',
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:linear-gradient(135deg,#5B4CF5,#8b5cf6);border-radius:24px 24px 0 0;padding:50px 40px;text-align:center;box-shadow:0 10px 25px rgba(91,76,245,0.15);">
      <h1 style="color:white;font-size:32px;font-weight:900;margin:0 0 12px;letter-spacing:-0.5px;">Studyhelp</h1>
      <p style="color:rgba(255,255,255,0.9);font-size:18px;margin:0;font-weight:500;">The tool behind every first class</p>
    </div>
    <div style="background-color:#ffffff;padding:40px;border-radius:0 0 24px 24px;border:1px solid #e2e8f0;border-top:none;box-shadow:0 20px 40px rgba(0,0,0,0.05);">
      <p style="font-size:18px;font-weight:700;color:#1e293b;margin:0 0 16px;">Hey ${data.userName || 'there'},</p>
      
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        Welcome to <strong>Studyhelp</strong> — the tool behind every first class.
      </p>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        You’re one step away from studying smarter. Here’s what to do right now:
      </p>
      
      <div style="background-color:#f0fdf4;border-left:4px solid #10b981;border-radius:8px;padding:20px;margin-bottom:30px;">
        <p style="font-size:15px;color:#1e293b;line-height:1.6;margin:0;">
          <strong>👉 Start your first practice session</strong> — it takes 5 minutes and shows you exactly where you stand.
        </p>
      </div>

      <div style="text-align:center;margin-bottom:30px;">
        <a href="${base}/dashboard"
          style="display:inline-block;background:linear-gradient(135deg,#5B4CF5,#4f46e5);color:white;font-size:16px;font-weight:700;padding:16px 36px;border-radius:12px;text-decoration:none;box-shadow:0 8px 16px rgba(91,76,245,0.25);">
          Start Studying Now →
        </a>
      </div>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        Students who study on day 1 are 3x more likely to pass their exams. Don’t wait.
      </p>

      <hr style="border:none;border-top:1px solid #f1f5f9;margin:32px 0;">

      <p style="font-size:15px;font-weight:600;color:#1e293b;margin:0;">— The Studyhelp Team</p>
    </div>
    <div style="text-align:center;padding:24px;font-size:12px;color:#94a3b8;line-height:1.6;">
      <p style="margin:0;">You are receiving this email because you recently signed up for Studyhelp.</p>
      <div style="margin-top:12px;">
        <a href="${base}/unsubscribe?email=${encodeURIComponent(data.email || '')}" style="color:#5B4CF5;text-decoration:none;font-weight:600;">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`,
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

    let user = await User.findOne({ firebaseUid: userId });
    if (!user) {
      try {
        user = await User.findById(userId);
      } catch (err) {
        // userId was not a valid ObjectId or query failed, ignore
      }
    }
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

    if (user.webPushSubscription && user.notificationsEnabled) {
      try {
        const linkPath = link.startsWith('/') ? link : `/${link}`;
        const fullUrl = `${frontendBase()}${linkPath}`;
        const payload = JSON.stringify({
          title,
          body,
          icon: '/android-chrome-192x192.png',
          data: { url: fullUrl }
        });
        await webpush.sendNotification(user.webPushSubscription, payload);
      } catch (wpErr) {
        if (wpErr.statusCode === 404 || wpErr.statusCode === 410) {
          await User.findOneAndUpdate({ _id: user._id }, { webPushSubscription: null });
        }
        console.error('[WebPush]', wpErr.message);
      }
    }

    if (EMAIL_TYPES.includes(type) && user.email && !user.emailUnsubscribed) {
      const emailContent = getEmailContent(type, { ...data, userName: user.name, email: user.email });
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
