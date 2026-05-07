import mongoose from 'mongoose';

const LibraryDocumentSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    subject: { type: String, default: '' },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    fileType: { type: String, default: 'application/pdf' },
    originalName: { type: String, default: '' },
    coverColor: { type: String, default: '#5B4CF5' },
    pages: { type: Number, default: 0 },
    publicId: { type: String, required: true },
    extractedText: { type: String, default: '' },
  },
  { timestamps: true }
);

LibraryDocumentSchema.index({ userId: 1, updatedAt: -1 });

const LibraryDocument = mongoose.model('LibraryDocument', LibraryDocumentSchema);

export default LibraryDocument;
