import mongoose from 'mongoose';

const streakSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastActivityDate: { type: Date, default: null },
    lastStudiedDate: { type: Date, default: null }, // legacy, prefer lastActivityDate
    todayActivityCount: { type: Number, default: 0 },
    todayActivities: [{
        type: {
            type: String,
            enum: ['timer', 'cbt', 'flashcard', 'question_generator']
        },
        timestamp: { type: Date, default: Date.now }
    }],
    streakHistory: [{
        date: String,
        activities: [String],
        count: Number
    }],
    createdAt: { type: Date, default: Date.now }
});

const Streak = mongoose.model('Streak', streakSchema);
export default Streak;
