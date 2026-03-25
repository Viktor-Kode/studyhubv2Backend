import mongoose from 'mongoose';

const resourcePostSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['file', 'link'], required: true },
    url: { type: String, default: null },
    title: { type: String, default: null },
  },
  { _id: false }
);

const pollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, default: null },
    votes: [{ type: String }], // firebase UIDs
  },
  { _id: false }
);

const groupPostSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },

    authorId: { type: String, required: true, index: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null },

    content: { type: String, required: true, maxlength: 1000 },
    subject: { type: String, default: null, maxlength: 80 },

    type: { type: String, enum: ['post', 'question', 'poll', 'resource'], default: 'post', index: true },
    resource: { type: resourcePostSchema, default: null },

    likes: [{ type: String }], // firebase UIDs
    commentsCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    isPinned: { type: Boolean, default: false },
    bestAnswerCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupComment', default: null },

    poll: {
      question: { type: String, default: null },
      options: { type: [pollOptionSchema], default: [] },
      endsAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

groupPostSchema.index({ createdAt: -1 });
groupPostSchema.index({ group: 1, createdAt: -1 });
groupPostSchema.index({ group: 1, subject: 1, createdAt: -1 });
groupPostSchema.index({ group: 1, likes: 1, createdAt: -1 });

export default mongoose.models.GroupPost || mongoose.model('GroupPost', groupPostSchema);

