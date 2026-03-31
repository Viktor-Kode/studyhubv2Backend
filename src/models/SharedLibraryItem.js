import mongoose from 'mongoose';

const sharedLibraryItemSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['link', 'file', 'text'], required: true },
    url: String,
    fileUrl: String,
    textContent: String,
    subject: String,
    tags: [{ type: String }],
    upvotes: [{ type: String }],
    downvotes: [{ type: String }],
    downloads: { type: Number, default: 0 },
    moderationStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
    },
}, { timestamps: true });

sharedLibraryItemSchema.index({ moderationStatus: 1, subject: 1, createdAt: -1 });

export default mongoose.model('SharedLibraryItem', sharedLibraryItemSchema);
