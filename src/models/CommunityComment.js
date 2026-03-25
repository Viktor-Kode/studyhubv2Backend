import mongoose from 'mongoose';

const CommunityCommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },

    // Null means a top-level comment. Otherwise, it is a reply to another comment.
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityComment', default: null },

    authorId: { type: String, required: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null }, // initials fallback

    content: { type: String, required: true, maxlength: 500 },
    mentionedFirebaseUids: [{ type: String }],
    likes: [{ type: String }], // reserved for future comment likes

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

CommunityCommentSchema.index({ postId: 1, parentId: 1, createdAt: 1 });

export default mongoose.models.CommunityComment ||
  mongoose.model('CommunityComment', CommunityCommentSchema);

