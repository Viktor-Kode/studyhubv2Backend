import mongoose from 'mongoose';

const CommunityGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 400 },
    createdBy: { type: String, required: true }, // firebase UID
    members: [{ type: String }], // firebase UIDs
  },
  { timestamps: true }
);

CommunityGroupSchema.index({ members: 1, updatedAt: -1 });

export default mongoose.models.CommunityGroup ||
  mongoose.model('CommunityGroup', CommunityGroupSchema);

