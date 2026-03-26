import mongoose from 'mongoose';

const GroupGoalSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 2000, default: '' },
    dueDate: { type: Date },
    completed: { type: Boolean, default: false },
    completedBy: { type: String },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

GroupGoalSchema.index({ groupId: 1, completed: 1, createdAt: -1 });

const GroupGoal = mongoose.model('GroupGoal', GroupGoalSchema);
export default GroupGoal;
