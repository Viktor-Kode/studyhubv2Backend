import mongoose from 'mongoose';

const libraryMaterialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    subject: { type: String, default: '' },
    topic: { type: String, default: '' },
    tags: [{ type: String }],
    folder: { type: String, default: 'General' },
    fileUrl: { type: String, required: true },
    publicId: { type: String, required: true },
    fileSize: { type: Number, default: 0 }, // bytes
    pageCount: { type: Number, default: 0 },
    color: { type: String, default: '#4F46E5' },
    isFavourite: { type: Boolean, default: false },
    lastReadPage: { type: Number, default: 1 },
    readProgress: { type: Number, default: 0 },
    examType: {
      type: String,
      enum: ['JAMB', 'WAEC', 'NECO', 'Post-UTME', 'University', 'Professional', 'Other'],
      default: 'Other',
    },
  },
  {
    timestamps: true,
  }
);

libraryMaterialSchema.index({ userId: 1, updatedAt: -1 });
libraryMaterialSchema.index({ userId: 1, folder: 1 });

const LibraryMaterial = mongoose.model('LibraryMaterial', libraryMaterialSchema);

export default LibraryMaterial;

