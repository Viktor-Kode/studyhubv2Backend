import Streak from '../models/Streak.js';
import mongoose from 'mongoose';

export const updateStreak = async (studentId, activityType) => {
    try {
        const id = new mongoose.Types.ObjectId(studentId);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let streak = await Streak.findOne({ studentId: id });

        if (!streak) {
            streak = await Streak.create({
                studentId: id,
                currentStreak: 1,
                longestStreak: 1,
                lastStudiedDate: today,
                streakHistory: [{ date: today, activity: activityType }]
            });
            return streak;
        }

        const lastDate = streak.lastStudiedDate
            ? new Date(streak.lastStudiedDate)
            : null;

        if (lastDate) {
            lastDate.setHours(0, 0, 0, 0);
        }

        const isToday = lastDate?.getTime() === today.getTime();
        const isYesterday = lastDate?.getTime() === yesterday.getTime();

        if (isToday) {
            streak.streakHistory.push({ date: new Date(), activity: activityType });
        } else if (isYesterday) {
            streak.currentStreak += 1;
            streak.longestStreak = Math.max(streak.currentStreak, streak.longestStreak);
            streak.lastStudiedDate = today;
            streak.streakHistory.push({ date: new Date(), activity: activityType });
        } else {
            streak.currentStreak = 1;
            streak.lastStudiedDate = today;
            streak.streakHistory.push({ date: new Date(), activity: activityType });
        }

        await streak.save();
        return streak;
    } catch (err) {
        console.error('updateStreak error:', err);
        return { currentStreak: 0, longestStreak: 0 };
    }
};
