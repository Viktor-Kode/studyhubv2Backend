import mongoose from 'mongoose';

const userStatsSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true
        },
        totalStudyMinutes: {
            type: Number,
            default: 0
        },
        sessionsCompleted: {
            type: Number,
            default: 0
        },
        studyStreak: {
            type: Number,
            default: 0
        },
        lastStudyDate: Date,
        badges: [String],
        level: {
            type: Number,
            default: 1
        },
        xp: {
            type: Number,
            default: 0
        },
        activeTimer: {
            isActive: Boolean,
            isPaused: Boolean,
            startedAt: Date,
            remainingAtPause: Number, // seconds
            totalDuration: Number, // seconds
            sessionType: { type: String, enum: ['work', 'break'] },
            subject: String,
            pomodoroCount: Number,
            sessionStartTime: Date,
            selectedGoalId: String
        },
        goals: [{
            title: String,
            targetMinutes: Number,
            period: { type: String, enum: ['daily', 'weekly'] },
            subject: String,
            color: String,
            completedMinutes: { type: Number, default: 0 }
        }]
    },
    { timestamps: true }
);

const UserStats = mongoose.model('UserStats', userStatsSchema);

export default UserStats;
