import mongoose from 'mongoose';
import crypto from 'crypto';

const documentHashSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    hash: {
        type: String,
        required: true,
        index: true
    },
    fileName: String,
    quizSessionIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuizSession'
    }]
}, { timestamps: true });

// Ensure uniqueness per user: A user can't have duplicate hashes, but different users can have same hash
documentHashSchema.index({ userId: 1, hash: 1 }, { unique: true });

// Static method to create hash from text
documentHashSchema.statics.createHash = function (text) {
    return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
};

const DocumentHash = mongoose.model('DocumentHash', documentHashSchema);

export default DocumentHash;
