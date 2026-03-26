import mongoose from 'mongoose';

const CommunityNotificationSchema = new mongoose.Schema(
  {
    recipientFirebaseUid: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['like', 'comment', 'comment_like', 'bestAnswer', 'mention', 'badge', 'rankUp', 'poll'],
      required: true,
    },
    actorFirebaseUid: { type: String, default: null },
    actorName: { type: String, default: null },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', default: null },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityComment', default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CommunityNotificationSchema.index({ recipientFirebaseUid: 1, read: 1, createdAt: -1 });

export default mongoose.models.CommunityNotification ||
  mongoose.model('CommunityNotification', CommunityNotificationSchema);
