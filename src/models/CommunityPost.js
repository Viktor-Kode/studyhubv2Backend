import mongoose from 'mongoose';

const CommunityPostSchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null }, // initials fallback

    content: { type: String, required: true, maxlength: 1000 },
    imageUrl: { type: String, default: null }, // optional Cloudinary URL
    subject: { type: String, default: null }, // tag e.g. "Biology"
    tags: [{ type: String }], // hashtags without #

    type: { type: String, enum: ['post', 'poll', 'question'], default: 'post' },

    likes: [{ type: String }], // userIds who liked (firebase UID strings)
    commentsCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    isPinned: { type: Boolean, default: false },
    bestAnswerCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityComment', default: null },

    poll: {
      question: { type: String, default: null },
      options: {
        type: [
          {
            text: { type: String, default: null },
            votes: [{ type: String }], // array of userIds (firebase UID strings)
          },
        ],
        default: [],
      },
      endsAt: { type: Date, default: null },
    },

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

CommunityPostSchema.index({ createdAt: -1 });
CommunityPostSchema.index({ subject: 1, createdAt: -1 });
CommunityPostSchema.index({ authorId: 1, createdAt: -1 });
CommunityPostSchema.index({ likes: 1, createdAt: -1 });
CommunityPostSchema.index({ isPinned: -1, createdAt: -1 });
CommunityPostSchema.index({ tags: 1 });

export default mongoose.models.CommunityPost ||
  mongoose.model('CommunityPost', CommunityPostSchema);

