import mongoose from 'mongoose';

const ReadingProgressSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryDocument',
      required: true,
      index: true,
    },
    currentPage: { type: Number, default: 1 },
    percentage: { type: Number, default: 0 },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ReadingProgressSchema.index({ userId: 1, documentId: 1 }, { unique: true });
ReadingProgressSchema.index({ userId: 1, lastReadAt: -1 });

const ReadingProgress = mongoose.model('ReadingProgress', ReadingProgressSchema);

export default ReadingProgress;
