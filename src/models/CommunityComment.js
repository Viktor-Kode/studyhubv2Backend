import mongoose from 'mongoose';

const CommunityCommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },

    authorId: { type: String, required: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null }, // initials fallback

    content: { type: String, required: true, maxlength: 500 },
    likes: [{ type: String }], // reserved for future comment likes

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

CommunityCommentSchema.index({ postId: 1, createdAt: 1 });

export default mongoose.models.CommunityComment ||
  mongoose.model('CommunityComment', CommunityCommentSchema);

