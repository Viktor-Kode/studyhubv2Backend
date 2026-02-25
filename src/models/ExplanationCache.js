import mongoose from 'mongoose';

const explanationCacheSchema = new mongoose.Schema({
    questionHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    questionText: String,
    correctAnswer: String,
    explanation: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

const ExplanationCache = mongoose.model('ExplanationCache', explanationCacheSchema);

export default ExplanationCache;
