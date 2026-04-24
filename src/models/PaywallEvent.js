import mongoose from 'mongoose';

const PaywallEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userEmail: {
        type: String,
        required: true
    },
    action: {
        type: String,
        required: true // e.g., 'AI_LIMIT_REACHED', 'FLASHCARD_LIMIT_REACHED', 'CBT_LIMIT_REACHED', 'SUBJECT_LOCKED'
    },
    context: {
        subject: String,
        examType: String,
        questionSet: String,
        additionalInfo: mongoose.Schema.Types.Mixed
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Index for faster queries on daily counts and user frequency
PaywallEventSchema.index({ timestamp: -1 });
PaywallEventSchema.index({ userId: 1 });

const PaywallEvent = mongoose.model('PaywallEvent', PaywallEventSchema);

export default PaywallEvent;
