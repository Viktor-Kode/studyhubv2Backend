import NotificationLog from '../models/NotificationLog.js';
import StudyPath from '../models/StudyPath.js';
import UserActivity from '../models/UserActivity.js';
import UserDailyActivity from '../models/UserDailyActivity.js';
import UserProgress from '../models/UserProgress.js';
import { sendEmail } from './emailService.js';
import { sendNotification } from './notificationService.js';
import { getEnv } from '../config/env.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const frontendBase = () => (getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app').replace(/\/+$/, '');

function timezoneFor(user) {
  const timezone = user.settings?.notificationPrefs?.timezone || 'Africa/Lagos';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); return timezone; }
  catch { return 'Africa/Lagos'; }
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (key) => parts.find((part) => part.type === key)?.value || '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

function isQuietNow(now, timezone, quietHours) {
  const start = quietHours?.start || '22:00';
  const end = quietHours?.end || '07:00';
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const local = localParts(now, timezone);
  const current = local.hour * 60 + local.minute;
  const from = (startHour || 0) * 60 + (startMinute || 0);
  const to = (endHour || 0) * 60 + (endMinute || 0);
  return from > to ? current >= from || current < to : current >= from && current < to;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function shortCopy(value, limit = 110) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function pathOwners(user) {
  return [user._id?.toString(), user.firebaseUid].filter(Boolean);
}

async function getCurrentStudyPath(user) {
  const paths = await StudyPath.find({ userId: { $in: pathOwners(user) } })
    .sort({ isActive: -1, updatedAt: -1 }).limit(10).lean();
  return paths.find((path) => !path.completed && path.challenge?.status !== 'completed' && !path.challenge?.passed) || null;
}

function nextStepFor(path) {
  const done = (path.nodes || []).filter((node) => node.status === 'completed').length;
  const nextNode = (path.nodes || []).find((node) => node.status === 'active')
    || (path.nodes || []).find((node) => node.status !== 'completed');
  if (nextNode) {
    const parsedMinutes = Number.parseInt(String(nextNode.duration || '').match(/\d+/)?.[0] || '5', 10);
    return {
      title: nextNode.title,
      body: shortCopy(`${done}/${path.nodes.length} lessons done in ${path.title}. Next: ${nextNode.title} (${parsedMinutes} min, +${nextNode.xp || 0} XP).`),
      url: `/dashboard/student/map/${encodeURIComponent(path.topicId)}?node=${encodeURIComponent(nextNode.id)}`,
      done,
      total: path.nodes.length,
    };
  }
  if (path.nodes?.length && path.challenge?.status !== 'completed' && !path.challenge?.passed) {
    return {
      title: 'Unit challenge is ready',
      body: shortCopy(`All ${path.nodes.length} lessons in ${path.title} are done. Take the unit challenge when you’re ready.`),
      url: `/dashboard/student/map/${encodeURIComponent(path.topicId)}/challenge`,
      done: path.nodes.length,
      total: path.nodes.length,
    };
  }
  return null;
}

async function createLog({ user, type, channel, dedupeKey, title, body, url }) {
  try {
    return await NotificationLog.create({ userId: user._id.toString(), type, channel, dedupeKey, title, body, url, status: 'pending', attempts: 1 });
  } catch (error) {
    if (error?.code === 11000) {
      const retryable = [
        { status: 'failed' },
        ...(getEnv('NOTIFICATIONS_DRY_RUN') === 'true' ? [] : [{ status: 'dry_run' }]),
        { status: 'pending', updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) } },
      ];
      return NotificationLog.findOneAndUpdate(
        {
          userId: user._id.toString(), dedupeKey, channel,
          $or: retryable,
          attempts: { $lt: 3 },
        },
        { $set: { status: 'pending', error: '' }, $inc: { attempts: 1 } },
        { new: true }
      );
    }
    throw error;
  }
}

async function deliver({ user, type, channel, dedupeKey, title, body, url, html, text }) {
  const log = await createLog({ user, type, channel, dedupeKey, title, body, url });
  if (!log) return false;

  if (getEnv('NOTIFICATIONS_DRY_RUN') === 'true') {
    console.log('[RetentionNotification:dry-run]', { userId: user._id.toString(), type, channel, title, body, url });
    await NotificationLog.updateOne({ _id: log._id }, { $set: { status: 'dry_run' } });
    return false;
  }

  try {
    if (channel === 'email') {
      const rawUrl = `${frontendBase()}${url}`;
      const trackedUrl = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}n=${log._id}`;
      const trackedHtml = html.replaceAll(escapeHtml(rawUrl), escapeHtml(trackedUrl));
      const trackedText = text ? `${text}\n\nContinue: ${trackedUrl}` : undefined;
      const subject = String(title).replace(/[\r\n]+/g, ' ').slice(0, 50);
      const result = await sendEmail({ to: user.email, subject, html: trackedHtml, text: trackedText });
      if (!result?.success) throw new Error(result?.error || 'Email provider did not confirm delivery');
    } else {
      const sent = await sendNotification({
        userId: user.firebaseUid || user._id.toString(),
        type: 'study_nudge', title, body, link: `${url}?n=${log._id}`, data: { url: `${frontendBase()}${url}?n=${log._id}` },
      });
      if (sent?.pushSent === false) throw new Error('No push subscription could be reached');
    }
    await NotificationLog.updateOne({ _id: log._id }, { $set: { status: 'sent', sentAt: new Date() } });
    return true;
  } catch (error) {
    await NotificationLog.updateOne({ _id: log._id }, { $set: { status: 'failed', error: String(error?.message || error).slice(0, 500) } });
    console.error('[RetentionNotification] delivery failed:', error?.message || error);
    return false;
  }
}

async function dailyPushCount(userId, now) {
  return NotificationLog.countDocuments({ userId, channel: 'push', status: 'sent', sentAt: { $gte: new Date(now.getTime() - DAY_MS) } });
}

async function sendStudyReminder(user, path, dayKey, now, allowPush = true) {
  const prefs = user.settings?.notificationPrefs || {};
  const step = nextStepFor(path);
  if (!step) return;
  const userId = user._id.toString();
  const recentNudge = await NotificationLog.findOne({ userId, type: 'study_reminder', status: 'sent' }).sort({ createdAt: -1 }).lean();
  if (recentNudge && (!user.lastSeen || new Date(user.lastSeen) <= new Date(recentNudge.createdAt))) return;

  const hasPush = Boolean(allowPush && user.notificationsEnabled && (user.fcmToken || user.webPushSubscription));
  const emailAllowed = Boolean(prefs.emailStudyReminders && user.email && !user.emailUnsubscribed);
  let channel = hasPush ? 'push' : emailAllowed ? 'email' : null;
  if (channel === 'push' && await dailyPushCount(userId, now) >= 2) channel = emailAllowed ? 'email' : null;
  if (!channel) {
    await NotificationLog.updateOne(
      { userId, type: 'study_reminder', dedupeKey: `study-reminder:${dayKey}`, channel: 'push' },
      { $setOnInsert: { title: 'Study reminder', body: 'A next step is ready when you are.', url: step.url, status: 'skipped', skipReason: allowPush ? 'No opted-in delivery channel is available' : 'Quiet hours; email backup is off' } },
      { upsert: true }
    ).catch((error) => { if (error?.code !== 11000) throw error; });
    return;
  }

  const title = channel === 'push' ? 'Your next study step is ready' : `A quick next step in ${path.title}`;
  const url = `${frontendBase()}${step.url}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#1e293b"><h1 style="color:#5b4cf5">${escapeHtml(title)}</h1><p>${escapeHtml(step.body)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#5b4cf5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Continue studying</a></p><p style="font-size:12px;color:#64748b">You can change study reminder preferences in <a href="${frontendBase()}/dashboard/settings?tab=notifications">Settings</a>.</p></div>`;
  const text = `${title}\n\n${step.body}\n\nManage reminders: ${frontendBase()}/dashboard/settings?tab=notifications`;
  const sent = await deliver({ user, type: 'study_reminder', channel, dedupeKey: `study-reminder:${dayKey}`, title, body: step.body, url: step.url, html, text });
  if (!sent && channel === 'push' && emailAllowed && getEnv('NOTIFICATIONS_DRY_RUN') !== 'true') {
    await deliver({ user, type: 'study_reminder', channel: 'email', dedupeKey: `study-reminder:${dayKey}`, title: `A quick next step in ${path.title}`, body: step.body, url: step.url, html, text });
  }
}

async function sendWeeklyDigest(user, path, weekKey, now) {
  const userId = user._id.toString();
  if (!user.settings?.notificationPrefs?.weeklyDigest || !user.email || user.emailUnsubscribed) return;
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [completions, activityDays, progress] = await Promise.all([
    UserActivity.countDocuments({ userId: user._id, type: 'study_node_completed', createdAt: { $gte: since } }),
    UserDailyActivity.countDocuments({ userId: user._id, dayKey: { $gte: since.toISOString().slice(0, 10) } }),
    UserProgress.findOne({ userId: { $in: [userId, user.firebaseUid].filter(Boolean) } }).select('weeklyXP').lean(),
  ]);
  if (!completions && !activityDays && !path) return;

  const title = 'Your StudyHelp week at a glance';
  const nextStep = path ? nextStepFor(path) : null;
  const summary = `${completions} lesson${completions === 1 ? '' : 's'} completed · ${activityDays} active day${activityDays === 1 ? '' : 's'} in the last seven days · ${progress?.weeklyXP || 0} XP earned this week.`;
  const next = nextStep ? `<h2 style="font-size:18px">Next up: ${escapeHtml(nextStep.title)}</h2><p>${escapeHtml(nextStep.body)}</p><a href="${escapeHtml(frontendBase() + nextStep.url)}" style="display:inline-block;background:#5b4cf5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Continue your map</a>` : '<p>Choose a topic and take one small step this week.</p>';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#1e293b"><h1 style="color:#5b4cf5">${escapeHtml(title)}</h1><p>Hi ${escapeHtml(user.name?.split(' ')[0] || 'there')}, here’s your study progress from the last seven days:</p><p style="font-size:18px;font-weight:700">${escapeHtml(summary)}</p>${next}<p style="font-size:12px;color:#64748b;margin-top:28px">Manage these emails in <a href="${frontendBase()}/dashboard/settings?tab=notifications">Settings</a>.</p></div>`;
  const text = `${title}\n\nHi ${user.name?.split(' ')[0] || 'there'}, here’s your study progress from the last seven days:\n${summary}${nextStep ? `\n\nNext up: ${nextStep.title}\n${nextStep.body}` : ''}\n\nManage emails: ${frontendBase()}/dashboard/settings?tab=notifications`;
  await deliver({ user, type: 'weekly_digest', channel: 'email', dedupeKey: `weekly-digest:${weekKey}`, title, body: summary, url: nextStep?.url || '/dashboard/student', html, text });
}

export async function runRetentionNotificationTick(now = new Date()) {
  let processed = 0;
  const cursor = User.find({
    $or: [
      { 'settings.notificationPrefs.studyReminders': true },
      { 'settings.notificationPrefs.weeklyDigest': true },
    ],
  }).select('name email firebaseUid settings notificationsEnabled fcmToken webPushSubscription emailUnsubscribed lastSeen').lean().cursor({ batchSize: 100 });

  const processUser = async (user) => {
    try {
      const prefs = user.settings?.notificationPrefs || {};
      const timezone = timezoneFor(user);
      const local = localParts(now, timezone);
      const [reminderHour, reminderMinute] = String(prefs.reminderTime || '18:00').split(':').map(Number);
      const dueReminder = prefs.studyReminders && local.hour === reminderHour && local.minute >= reminderMinute && local.minute < reminderMinute + 15;
      const dueDigest = prefs.weeklyDigest && local.weekday === 'Sun' && local.hour === 17 && local.minute < 15;
      if (!dueReminder && !dueDigest) return;

      const path = await getCurrentStudyPath(user);
      if (dueReminder && path) {
        const inactiveForTwoDays = user.lastSeen && now.getTime() - new Date(user.lastSeen).getTime() >= 2 * DAY_MS;
        if (inactiveForTwoDays) await sendStudyReminder(user, path, local.day, now, !isQuietNow(now, timezone, prefs.quietHours));
      }
      if (dueDigest) {
        await sendWeeklyDigest(user, path, local.day, now);
      }
      processed++;
    } catch (error) {
      console.error(`[RetentionNotification] user ${user._id} tick failed:`, error?.message || error);
    }
  };

  let batch = [];
  for await (const user of cursor) {
    batch.push(user);
    if (batch.length === 5) {
      await Promise.all(batch.map(processUser));
      batch = [];
    }
  }
  if (batch.length) await Promise.all(batch.map(processUser));
  return { processed };
}

export async function trackNotificationClick(user, logId) {
  if (!user?._id || !logId) return false;
  const result = await NotificationLog.updateOne(
    { _id: logId, userId: user._id.toString(), status: 'sent' },
    { $set: { clickedAt: new Date() } }
  );
  return result.modifiedCount > 0;
}
