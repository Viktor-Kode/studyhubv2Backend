import mongoose from 'mongoose';

const CommunityGroupMessageSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityGroup', required: true },
    authorId: { type: String, required: true }, // firebase UID
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null },
    content: { type: String, required: true, maxlength: 1000 },
  },
  { timestamps: true }
);

CommunityGroupMessageSchema.index({ groupId: 1, createdAt: 1 });

export default mongoose.models.CommunityGroupMessage ||
  mongoose.model('CommunityGroupMessage', CommunityGroupMessageSchema);

