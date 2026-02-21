import mongoose from 'mongoose';

const flashCardDeckSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        default: 'General'
    },
    cardCount: {
        type: Number,
        default: 0
    },
    isPublic: {
        type: Boolean,
        default: false
    },
    tags: [{
        type: String,
        trim: true
    }],
    color: {
        type: String,
        default: '#3B82F6' // Default blue color
    },
    icon: {
        type: String,
        default: '📚'
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

flashCardDeckSchema.pre('save', function () {
    this.updatedAt = new Date();
});

const FlashCardDeck = mongoose.model('FlashCardDeck', flashCardDeckSchema);
export default FlashCardDeck;
