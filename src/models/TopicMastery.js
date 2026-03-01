import mongoose from 'mongoose';

const TopicMasterySchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    topic: {
        type: String,
        required: true
    },
    subject: {
        type: String
    },
    mastery: {
        type: String,
        enum: ['weak', 'developing', 'mastered'],
        default: 'weak'
    },
    accuracy: {
        type: Number,
        default: 0
    },
    totalAttempts: {
        type: Number,
        default: 0
    },
    lastPracticed: {
        type: Date,
        default: Date.now
    }
});

TopicMasterySchema.index({ studentId: 1, topic: 1 }, { unique: true });

const TopicMastery = mongoose.model('TopicMastery', TopicMasterySchema);

export default TopicMastery;
