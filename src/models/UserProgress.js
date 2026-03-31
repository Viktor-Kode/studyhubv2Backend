import mongoose from 'mongoose';

const badgeSchema = new mongoose.Schema({
    id: String,
    name: String,
    description: String,
    icon: String,
    earnedAt: { type: Date, default: Date.now }
});

const userProgressSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    levelName: { type: String, default: 'Beginner' },
    streak: { type: Number, default: 0 },
    lastLoginDate: { type: String, default: null },
    badges: [badgeSchema],
    weeklyXP: { type: Number, default: 0 },
    weekStart: { type: String, default: null },
    totalCBTDone: { type: Number, default: 0 },
    totalQuestionsAnswered: { type: Number, default: 0 },
    totalTopicsStudied: { type: Number, default: 0 },
    highScoreCBTCount: { type: Number, default: 0 },
    /** YYYY-MM-DD — last day library upvote XP was awarded (max once per day) */
    lastLibraryUpvoteDay: { type: String, default: null },
    /** YYYY-MM-DD — last day the “4 pomodoros” bonus was awarded */
    lastPomodoroDailyBonusDay: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('UserProgress', userProgressSchema);
