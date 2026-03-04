import mongoose from 'mongoose';

const studyNoteSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    // Optional subject/topic metadata for better organisation
    subject: {
        type: String,
        default: 'General'
    },
    topic: {
        type: String,
        default: ''
    },
    // Origin of the note
    source: {
        type: String,
        enum: ['ai-generated', 'manual', 'flashcard', 'cbt'],
        default: 'manual'
    },
    // Optional original file name for AI-imported notes
    sourceFileName: {
        type: String
    },
    tags: [{
        type: String
    }],
    color: {
        type: String,
        default: '#ffffff'
    },
    isPinned: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Optimise common access pattern: user + subject, pinned first, newest first
studyNoteSchema.index({ userId: 1, subject: 1, isPinned: -1, createdAt: -1 });

const StudyNote = mongoose.model('StudyNote', studyNoteSchema);

export default StudyNote;
