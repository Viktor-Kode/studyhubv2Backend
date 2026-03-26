import mongoose from 'mongoose';

const GroupWhiteboardSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true, unique: true },
    content: { type: String, default: '', maxlength: 50000 },
    lastEditedBy: { type: String },
    lastEditedAt: { type: Date },
    version: { type: Number, default: 0 },
    pointDays: [
      {
        userId: { type: String, required: true },
        day: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
);

const GroupWhiteboard = mongoose.model('GroupWhiteboard', GroupWhiteboardSchema);
export default GroupWhiteboard;
