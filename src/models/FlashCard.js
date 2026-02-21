import mongoose from 'mongoose';

const flashCardSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    front: {
        type: String,
        required: true,
        trim: true
    },
    back: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        default: 'General'
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    tags: [{
        type: String,
        trim: true
    }],
    reviewCount: {
        type: Number,
        default: 0
    },
    correctCount: {
        type: Number,
        default: 0
    },
    incorrectCount: {
        type: Number,
        default: 0
    },
    lastReviewed: {
        type: Date
    },
    nextReviewDate: {
        type: Date
    },
    masteryLevel: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    isFavorite: {
        type: Boolean,
        default: false
    },
    deckId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FlashCardDeck'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient querying
flashCardSchema.index({ userId: 1, category: 1 });
flashCardSchema.index({ userId: 1, nextReviewDate: 1 });
flashCardSchema.index({ userId: 1, isFavorite: 1 });

// Update timestamp on save
flashCardSchema.pre('save', function () {
    this.updatedAt = new Date();
});

const FlashCard = mongoose.model('FlashCard', flashCardSchema);
export default FlashCard;
