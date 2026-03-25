import mongoose from 'mongoose';

const groupStudySessionSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },

    title: { type: String, required: true, maxlength: 120 },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date, default: null },
    meetingLink: { type: String, default: null },

    createdBy: { type: String, required: true, index: true }, // firebase UID
    attendees: [{ type: String, index: true }], // firebase UIDs
  },
  { timestamps: true }
);

groupStudySessionSchema.index({ group: 1, startTime: 1 });

export default mongoose.models.GroupStudySession ||
  mongoose.model('GroupStudySession', groupStudySessionSchema);

