import mongoose from 'mongoose';

const flashcardProgressSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deckId: { type: String },
    subject: { type: String },
    cardId: { type: String },
    status: {
        type: String,
        enum: ['unseen', 'learning', 'mastered'],
        default: 'unseen'
    },
    seenCount: { type: Number, default: 0 },
    masteredCount: { type: Number, default: 0 },
    lastReviewed: { type: Date }
});

flashcardProgressSchema.index({ studentId: 1, deckId: 1, cardId: 1 }, { unique: true });

const FlashcardProgress = mongoose.model('FlashcardProgress', flashcardProgressSchema);
export default FlashcardProgress;
