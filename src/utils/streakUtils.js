import Streak from '../models/Streak.js';

export const updateStreak = async (studentId, activityType) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    let streak = await Streak.findOne({ studentId });

    if (!streak) {
        streak = await Streak.create({
            studentId,
            currentStreak: 1,
            longestStreak: 1,
            lastStudiedDate: today,
            streakHistory: [{ date: today, activity: activityType }]
        });
        return streak;
    }

    const lastDate = streak.lastStudiedDate
        ? new Date(streak.lastStudiedDate).setHours(0, 0, 0, 0)
        : null;

    if (lastDate === today.getTime()) {
        // Already studied today — just log activity, don't increment
        streak.streakHistory.push({ date: today, activity: activityType });
    } else if (lastDate === yesterday.getTime()) {
        // Studied yesterday — extend streak
        streak.currentStreak += 1;
        streak.longestStreak = Math.max(streak.currentStreak, streak.longestStreak);
        streak.lastStudiedDate = today;
        streak.streakHistory.push({ date: today, activity: activityType });
    } else {
        // Streak broken — reset
        streak.currentStreak = 1;
        streak.lastStudiedDate = today;
        streak.streakHistory.push({ date: today, activity: activityType });
    }

    await streak.save();
    return streak;
};
