import mongoose from 'mongoose';
import PushNotification from '../models/PushNotification.js';
import User from '../models/User.js';
import { sendBulkNotification } from '../services/notificationService.js';

export const getNotifications = async (req, res) => {
  try {
    const uid = req.user.firebaseUid;
    if (!uid) {
      return res.status(400).json({ error: 'Missing Firebase UID' });
    }
    const notifications = await PushNotification.find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    const unreadCount = await PushNotification.countDocuments({ userId: uid, isRead: false });
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const uid = req.user.firebaseUid;
    if (!uid) {
      return res.status(400).json({ error: 'Missing Firebase UID' });
    }
    await PushNotification.updateMany({ userId: uid, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const markOneRead = async (req, res) => {
  try {
    const uid = req.user.firebaseUid;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const n = await PushNotification.findOneAndUpdate(
      { _id: req.params.id, userId: uid },
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
    const uid = req.user.firebaseUid;
    if (!uid) {
      return res.status(400).json({ error: 'Missing Firebase UID' });
    }
    await User.findOneAndUpdate(
      { firebaseUid: uid },
      { fcmToken: token, notificationsEnabled: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const disableNotifications = async (req, res) => {
  try {
    const uid = req.user.firebaseUid;
    if (!uid) {
      return res.status(400).json({ error: 'Missing Firebase UID' });
    }
    await User.findOneAndUpdate({ firebaseUid: uid }, { fcmToken: null, notificationsEnabled: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
