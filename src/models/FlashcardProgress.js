import mongoose from 'mongoose';

const flashcardProgressSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deckId: { type: String },
    cardId: { type: String },
    subject: { type: String },
    topic: { type: String },

    // Spaced repetition fields
    status: {
        type: String,
        enum: ['unseen', 'learning', 'reviewing', 'mastered'],
        default: 'unseen'
    },
    confidence: { type: Number, default: 0 }, // 0-5 scale
    reviewCount: { type: Number, default: 0 },
    correctStreak: { type: Number, default: 0 }, // consecutive correct answers
    incorrectCount: { type: Number, default: 0 },

    // Spaced repetition scheduling
    nextReviewDate: { type: Date, default: Date.now },
    intervalDays: { type: Number, default: 1 }, // days until next review
    easeFactor: { type: Number, default: 2.5 }, // SM-2 algorithm factor

    lastReviewed: { type: Date }
}, { timestamps: true });

flashcardProgressSchema.index({ studentId: 1, deckId: 1, cardId: 1 }, { unique: true });

const FlashcardProgress = mongoose.model('FlashcardProgress', flashcardProgressSchema);
export default FlashcardProgress;
