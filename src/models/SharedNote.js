import mongoose from 'mongoose';

const sharedNoteSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    isPublic: { type: Boolean, default: false },
    sharedWith: [{ type: String }], // User._id strings
    subject: { type: String },
    tags: [{ type: String }],
    likes: [{ type: String }],
    viewCount: { type: Number, default: 0 },
    /** XP for share_note awarded when note first became public */
    shareXpAwarded: { type: Boolean, default: false },
}, { timestamps: true });

sharedNoteSchema.index({ title: 'text', subject: 'text', tags: 'text' });
sharedNoteSchema.index({ isPublic: 1, updatedAt: -1 });

export default mongoose.model('SharedNote', sharedNoteSchema);
