import mongoose from 'mongoose';
import PushNotification from '../models/PushNotification.js';
import User from '../models/User.js';
import { sendBulkNotification } from '../services/notificationService.js';
import { trackNotificationClick } from '../services/retentionNotificationService.js';

const getUserNotificationFilter = (user) => {
  const uid = user?.firebaseUid;
  const mongoId = user?._id?.toString() || user?.id?.toString();
  if (uid && mongoId) return { $or: [{ userId: uid }, { userId: mongoId }] };
  if (uid) return { userId: uid };
  if (mongoId) return { userId: mongoId };
  return null;
};

export const getNotifications = async (req, res) => {
  try {
    const filter = getUserNotificationFilter(req.user);
    if (!filter) {
      return res.status(400).json({ error: 'User identification required' });
    }
    const notifications = await PushNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    const unreadCount = await PushNotification.countDocuments({ ...filter, isRead: false });
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const filter = getUserNotificationFilter(req.user);
    if (!filter) {
      return res.status(400).json({ error: 'User identification required' });
    }
    await PushNotification.updateMany({ ...filter, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const markOneRead = async (req, res) => {
  try {
    const filter = getUserNotificationFilter(req.user);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const n = await PushNotification.findOneAndUpdate(
      { _id: req.params.id, ...filter },
      { isRead: true },
      { new: true }
    );
    if (!n) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const registerToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token required' });
    }
    const filter = getUserNotificationFilter(req.user);
    if (!filter) {
      return res.status(400).json({ error: 'User identification required' });
    }
    await User.findByIdAndUpdate(req.user._id, { fcmToken: token, notificationsEnabled: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const disableNotifications = async (req, res) => {
  try {
    const filter = getUserNotificationFilter(req.user);
    if (!filter) {
      return res.status(400).json({ error: 'User identification required' });
    }
    await User.findByIdAndUpdate(req.user._id, { fcmToken: null, notificationsEnabled: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const registerWebPush = async (req, res) => {
  try {
    let subscription = req.body.subscription || req.body;
    if (!subscription || !subscription.endpoint || typeof subscription.endpoint !== 'string') {
      return res.status(400).json({ error: 'subscription required' });
    }
    try {
      if (new URL(subscription.endpoint).protocol !== 'https:') return res.status(400).json({ error: 'Subscription endpoint must use HTTPS' });
    } catch { return res.status(400).json({ error: 'Invalid subscription endpoint' }); }
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      return res.status(400).json({ error: 'Subscription keys are required' });
    }
    const uid = req.user.firebaseUid || req.user._id || req.user.id;
    if (!filter) {
      return res.status(400).json({ error: 'Missing User ID' });
    }
    const filter = req.user.firebaseUid ? { firebaseUid: uid } : { _id: uid };
    const update = { webPushSubscription: subscription, notificationsEnabled: true };
    if (typeof req.body.timezone === 'string') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: req.body.timezone });
        update['settings.notificationPrefs.timezone'] = req.body.timezone;
      } catch { /* ignore unsupported time zones */ }
    }
    await User.findOneAndUpdate(filter, { $set: update });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const trackNotification = async (req, res) => {
  try {
    const logId = String(req.body?.logId || '');
    if (!mongoose.Types.ObjectId.isValid(logId)) return res.status(400).json({ success: false, error: 'Invalid logId' });
    const tracked = await trackNotificationClick(req.user, logId);
    return res.json({ success: true, tracked });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const adminNotifyAll = async (req, res) => {
  try {
    const { title, body, link } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }
    const users = await User.find({ firebaseUid: { $exists: true, $ne: null } }).select('firebaseUid').lean();
    const userIds = users.map((u) => u.firebaseUid).filter(Boolean);
    sendBulkNotification({
      userIds,
      type: 'admin_announcement',
      title,
      body,
      icon: '📢',
      link: link || '/dashboard/student',
      data: { title, body },
    });
    res.json({ success: true, totalRecipients: userIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
