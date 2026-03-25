import mongoose from 'mongoose';

const groupNotificationSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },

    recipientFirebaseUid: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        'invite',
        'post',
        'comment',
        'mention',
        'resource',
        'session',
        'todo',
        'chat_mention',
      ],
      required: true,
    },

    actorFirebaseUid: { type: String, default: null },
    actorName: { type: String, default: null },

    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupPost', default: null },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupComment', default: null },
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupResource', default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupStudySession', default: null },
    todoId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupTodo', default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },

    // Used for "upcoming sessions" reminders
    scheduledFor: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

groupNotificationSchema.index({ group: 1, recipientFirebaseUid: 1, createdAt: -1, read: 1 });

export default mongoose.models.GroupNotification || mongoose.model('GroupNotification', groupNotificationSchema);

