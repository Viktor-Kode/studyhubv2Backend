import PomodoroSession from '../models/PomodoroSession.js';
import { awardXP } from './progressController.js';

const userKey = (req) => String(req.user._id);

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function startOfWeek(d) {
    const x = startOfDay(d);
    const day = x.getDay();
    x.setDate(x.getDate() - day);
    return x;
}

export const logPomodoroSession = async (req, res) => {
    try {
        const { duration, type, completed, taskName, startTime, endTime } = req.body;
        if (duration == null || !type) {
            return res.status(400).json({ success: false, message: 'duration and type required' });
        }
        if (!['work', 'shortBreak', 'longBreak'].includes(type)) {
            return res.status(400).json({ success: false, message: 'invalid type' });
        }
        const userId = userKey(req);
        const doc = await PomodoroSession.create({
            userId,
            duration: Number(duration),
            type,
            completed: !!completed,
            taskName: taskName ? String(taskName).slice(0, 200) : '',
            startTime: startTime ? new Date(startTime) : null,
            endTime: endTime ? new Date(endTime) : null,
        });
        let xpPreview = null;
        if (completed && type === 'work') {
            const xp1 = await awardXP(userId, 'pomodoro_complete');
            if (xp1) xpPreview = { pomodoro_complete: xp1.xpAdded };
            const dayStart = startOfDay(new Date());
            const workToday = await PomodoroSession.countDocuments({
                userId,
                type: 'work',
                completed: true,
                createdAt: { $gte: dayStart },
            });
            if (workToday >= 4) {
                const xp4 = await awardXP(userId, 'pomodoro_streak_daily');
                if (xp4) {
                    xpPreview = { ...xpPreview, pomodoro_streak_daily: xp4.xpAdded };
                }
            }
        }
        res.status(201).json({ success: true, session: doc, xp: xpPreview });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getPomodoroStats = async (req, res) => {
    try {
        const userId = userKey(req);
        const now = new Date();
        const dayStart = startOfDay(now);
        const weekStart = startOfWeek(now);

        const todaySessions = await PomodoroSession.find({
            userId,
            createdAt: { $gte: dayStart },
        }).lean();

        const workDoneToday = todaySessions.filter((s) => s.type === 'work' && s.completed);
        const pomodorosToday = workDoneToday.length;
        const focusMinutesToday = workDoneToday.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);

        const weekSessions = await PomodoroSession.find({
            userId,
            type: 'work',
            completed: true,
            createdAt: { $gte: weekStart },
        }).lean();

        const daysWithPomodoro = new Set(
            weekSessions.map((s) => startOfDay(new Date(s.createdAt)).toISOString().split('T')[0]),
        );

        const history = await PomodoroSession.find({ userId })
            .sort({ createdAt: -1 })
            .limit(30)
            .lean();

        res.json({
            success: true,
            stats: {
                pomodorosToday,
                focusMinutesToday,
                focusHoursToday: Math.round((focusMinutesToday / 60) * 10) / 10,
                weekStreakDays: daysWithPomodoro.size,
                totalWorkSessionsWeek: weekSessions.length,
            },
            recent: history,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getPomodoroHistory = async (req, res) => {
    try {
        const userId = userKey(req);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const history = await PomodoroSession.find({ userId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
