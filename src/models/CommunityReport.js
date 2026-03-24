import mongoose from 'mongoose';

const CommunityReportSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', default: null },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityComment', default: null },
    reporterFirebaseUid: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CommunityReportSchema.index({ postId: 1, createdAt: -1 });
CommunityReportSchema.index({ resolved: 1 });

export default mongoose.models.CommunityReport ||
  mongoose.model('CommunityReport', CommunityReportSchema);
