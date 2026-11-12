import mongoose from 'mongoose';

const PushNotificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    type: {
      type: String,
      required: true,
      default: 'general',
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    icon: { type: String },
    link: { type: String },
    isRead: { type: Boolean, default: false },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

PushNotificationSchema.index({ userId: 1, createdAt: -1 });
PushNotificationSchema.index({ userId: 1, isRead: 1 });

const PushNotification =
  mongoose.models.PushNotification ||
  mongoose.model('PushNotification', PushNotificationSchema);

export default PushNotification;
