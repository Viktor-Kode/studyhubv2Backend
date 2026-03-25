import mongoose from 'mongoose';

const groupResourceSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },

    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 400 },

    type: { type: String, enum: ['file', 'link'], required: true },
    url: { type: String, required: true },

    uploadedBy: { type: String, required: true, index: true }, // firebase UID
  },
  { timestamps: true }
);

groupResourceSchema.index({ group: 1, createdAt: -1 });

export default mongoose.models.GroupResource || mongoose.model('GroupResource', groupResourceSchema);

