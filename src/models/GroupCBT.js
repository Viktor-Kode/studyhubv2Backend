import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
    score: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    completed: { type: Boolean, default: false },
    finishedAt: { type: Date, default: null },
    timeTaken: { type: Number, default: null },
    xpAwarded: { type: Boolean, default: false },
    top3BonusAwarded: { type: Boolean, default: false },
    answers: {
        type: [{
            questionIndex: Number,
            selectedAnswer: String,
            isCorrect: Boolean,
        }],
        default: [],
    },
}, { _id: false });

const groupCBTSessionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    createdBy: { type: String, required: true },
    subject: { type: String, required: true },
    examType: { type: String, required: true },
    year: { type: String, default: 'any' },
    questionCount: { type: Number, default: 10 },
    /** Populated when session starts — same items for all members */
    questionsSnapshot: { type: Array, default: [] },
    members: [memberSchema],
    status: { type: String, enum: ['open', 'in_progress', 'completed'], default: 'open' },
    startedAt: Date,
    endedAt: Date,
    maxMembers: { type: Number, default: 10 },
    inviteCode: { type: String, unique: true, sparse: true },
}, { timestamps: true });

groupCBTSessionSchema.index({ inviteCode: 1 });
groupCBTSessionSchema.index({ createdBy: 1, status: 1 });

export default mongoose.model('GroupCBT', groupCBTSessionSchema);
