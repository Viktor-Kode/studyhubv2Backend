import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 400 },
    subject: { type: String, required: true, maxlength: 80 },
    isPrivate: { type: Boolean, default: false },
    inviteCode: { type: String, default: null, index: true },
    bannerImage: { type: String, default: null },
    createdBy: { type: String, required: true }, // firebase UID
    lastActiveAt: { type: Date, default: Date.now },
    settings: {
      allowMemberPosts: { type: Boolean, default: true },
      requireApproval: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

groupSchema.index({ subject: 1, createdAt: -1 });
groupSchema.index({ lastActiveAt: -1 });
groupSchema.index({ inviteCode: 1 });

export default mongoose.models.Group || mongoose.model('Group', groupSchema);

