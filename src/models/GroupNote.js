import mongoose from 'mongoose';

const GroupNoteSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true },
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    lastEditedBy: String,
    lastEditedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const GroupNote = mongoose.model('StudyGroupNote', GroupNoteSchema);
export default GroupNote;
