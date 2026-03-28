import mongoose from 'mongoose';

const PushNotificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'post_like',
        'post_comment',
        'group_join',
        'cbt_result',
        'payment_confirmed',
        'plan_expiring',
        'new_post_follow',
        'streak_ending',
        'admin_announcement',
      ],
      required: true,
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
