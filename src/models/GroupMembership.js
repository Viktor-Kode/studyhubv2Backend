import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    user: { type: String, required: true, index: true }, // firebase UID
    role: { type: String, enum: ['admin', 'moderator', 'member'], default: 'member', index: true },
    status: { type: String, enum: ['active', 'pending'], default: 'active' },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

memberSchema.index({ group: 1, user: 1 }, { unique: true });

export default mongoose.models.GroupMembership || mongoose.model('GroupMembership', memberSchema);

