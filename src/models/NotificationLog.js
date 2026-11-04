import mongoose from 'mongoose';

const notificationLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  channel: { type: String, enum: ['push', 'email'], required: true },
  dedupeKey: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  url: { type: String, default: '/dashboard/student' },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped', 'dry_run'], default: 'pending', index: true },
  skipReason: { type: String, default: '' },
  error: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, default: null },
  clickedAt: { type: Date, default: null },
}, { timestamps: true });

notificationLogSchema.index({ userId: 1, dedupeKey: 1, channel: 1 }, { unique: true });
notificationLogSchema.index({ userId: 1, createdAt: -1 });
notificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.NotificationLog || mongoose.model('NotificationLog', notificationLogSchema);
