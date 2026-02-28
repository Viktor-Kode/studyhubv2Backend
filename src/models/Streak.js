import mongoose from 'mongoose';

const streakSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastStudiedDate: { type: Date, default: null },
    streakHistory: [{ date: Date, activity: String }]
});

const Streak = mongoose.model('Streak', streakSchema);
export default Streak;
