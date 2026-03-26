import mongoose from 'mongoose';

const GroupMessageSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    authorAvatar: { type: String },
    content: { type: String, required: true, maxlength: 1000 },
    type: { type: String, enum: ['text', 'system', 'ai'], default: 'text' },
    reactions: [
      {
        emoji: String,
        users: [String],
      },
    ],
    replyTo: {
      messageId: mongoose.Schema.Types.ObjectId,
      authorName: String,
      preview: String,
    },
  },
  { timestamps: true },
);

GroupMessageSchema.index({ groupId: 1, createdAt: -1 });

const GroupMessage = mongoose.model('GroupMessage', GroupMessageSchema);
export default GroupMessage;
