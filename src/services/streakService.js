import Streak from '../models/Streak.js';
import mongoose from 'mongoose';

const VALID_ACTIVITIES = ['timer', 'cbt', 'flashcard', 'question_generator'];

const getTodayString = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
};

const getYesterdayString = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
};

export const updateStreak = async (studentId, activityType) => {
    try {
        if (!VALID_ACTIVITIES.includes(activityType)) {
            console.warn(`[Streak] Invalid activity type: ${activityType}`);
            return null;
        }

        const id = new mongoose.Types.ObjectId(studentId);
        const today = getTodayString();
        const yesterday = getYesterdayString();

        let streak = await Streak.findOne({ studentId: id });

        if (!streak) {
            streak = new Streak({
                studentId: id,
                currentStreak: 1,
                longestStreak: 1,
                lastActivityDate: new Date(),
                todayActivityCount: 1,
                todayActivities: [{ type: activityType, timestamp: new Date() }],
                streakHistory: [{ date: today, activities: [activityType], count: 1 }]
            });
            await streak.save();
            console.log(`[Streak] New streak started for ${studentId}`);
            return streak;
        }

        const lastDate = (streak.lastActivityDate || streak.lastStudiedDate)
            ? new Date(streak.lastActivityDate || streak.lastStudiedDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
            : null;

        if (lastDate === today) {
            streak.todayActivityCount += 1;
            streak.todayActivities.push({ type: activityType, timestamp: new Date() });

            const todayEntry = streak.streakHistory.find(h => h.date === today);
            if (todayEntry) {
                todayEntry.activities.push(activityType);
                todayEntry.count += 1;
            } else {
                streak.streakHistory.push({ date: today, activities: [activityType], count: 1 });
            }

            console.log(`[Streak] Activity logged for today. Streak stays at ${streak.currentStreak}`);
        } else if (lastDate === yesterday) {
            streak.currentStreak += 1;
            streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);
            streak.lastActivityDate = new Date();
            streak.todayActivityCount = 1;
            streak.todayActivities = [{ type: activityType, timestamp: new Date() }];
            streak.streakHistory.push({ date: today, activities: [activityType], count: 1 });

            console.log(`[Streak] Streak extended to ${streak.currentStreak} for ${studentId}`);
        } else {
            console.log(`[Streak] Streak broken for ${studentId}. Was ${streak.currentStreak}, resetting to 1`);
            streak.currentStreak = 1;
            streak.lastActivityDate = new Date();
            streak.todayActivityCount = 1;
            streak.todayActivities = [{ type: activityType, timestamp: new Date() }];
            streak.streakHistory.push({ date: today, activities: [activityType], count: 1 });
        }

        if (streak.streakHistory.length > 90) {
            streak.streakHistory = streak.streakHistory.slice(-90);
        }

        await streak.save();
        return streak;
    } catch (err) {
        console.error('[Streak] updateStreak error:', err.message);
        return null;
    }
};

export const getStreak = async (studentId) => {
    try {
        const id = new mongoose.Types.ObjectId(studentId);
        const streak = await Streak.findOne({ studentId: id });
        if (!streak) return { currentStreak: 0, longestStreak: 0, lastActivityDate: null };
        return streak;
    } catch (err) {
        console.error('[Streak] getStreak error:', err.message);
        return { currentStreak: 0, longestStreak: 0, lastActivityDate: null };
    }
};
