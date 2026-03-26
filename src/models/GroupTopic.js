import mongoose from 'mongoose';

const GroupTopicSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true, index: true },
    topic: { type: String, required: true, maxlength: 300 },
    assignedTo: { type: String },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed'],
      default: 'pending',
    },
    notes: { type: String, maxlength: 4000, default: '' },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

GroupTopicSchema.index({ groupId: 1, createdAt: -1 });

const GroupTopic = mongoose.model('GroupTopic', GroupTopicSchema);
export default GroupTopic;
