import mongoose from 'mongoose';

const flashCardSessionSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    deckId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FlashCardDeck'
    },
    cardsStudied: {
        type: Number,
        default: 0
    },
    correctAnswers: {
        type: Number,
        default: 0
    },
    incorrectAnswers: {
        type: Number,
        default: 0
    },
    duration: {
        type: Number, // in seconds
        default: 0
    },
    sessionType: {
        type: String,
        enum: ['study', 'review', 'quiz'],
        default: 'study'
    },
    completedAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

flashCardSessionSchema.index({ userId: 1, createdAt: -1 });

const FlashCardSession = mongoose.model('FlashCardSession', flashCardSessionSchema);
export default FlashCardSession;
