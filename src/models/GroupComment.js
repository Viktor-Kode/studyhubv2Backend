import mongoose from 'mongoose';

const groupCommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupPost', required: true, index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupComment', default: null, index: true },

    authorId: { type: String, required: true, index: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null },

    content: { type: String, required: true, maxlength: 500 },
    mentionedFirebaseUids: [{ type: String }],
    likes: [{ type: String }], // firebase UIDs
  },
  { timestamps: true }
);

groupCommentSchema.index({ postId: 1, parentId: 1, createdAt: 1 });

export default mongoose.models.GroupComment || mongoose.model('GroupComment', groupCommentSchema);

