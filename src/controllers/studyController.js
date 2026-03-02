import StudySession from '../models/StudySession.js';
import UserStats from '../models/UserStats.js';
import FlashCard from '../models/FlashCard.js';
import Question from '../models/Question.js';
import mongoose from 'mongoose';
import { updateStreak } from '../utils/streakUtils.js';

/**
 * Log a new study session
 */
export const createSession = async (req, res) => {
    try {
        const userId = req.user._id;
        const { title, type, duration, startTime, endTime, notes, goalId } = req.body;

        if (duration === undefined || duration === null) {
            return res.status(400).json({ error: 'Duration is required' });
        }

        const sessionData = {
            userId,
            title: title || (type === 'break' ? 'Short Break' : 'Productive Session'),
            type: type || 'study',
            duration: parseInt(duration),
            startTime: startTime || new Date(),
            endTime: endTime || new Date(),
            notes
        };

        if (goalId) sessionData.goalId = goalId;

        const session = new StudySession(sessionData);
        await session.save();

        let goalCompleted = false;
        let goalTitle = '';

        // Update UserStats streak and totals if it's a study session
        if (type === 'study' || !type) {
            await updateStreak(userId, 'study');

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let stats = await UserStats.findOne({ userId });
            if (!stats) {
                stats = new UserStats({ userId });
            }

            stats.lastStudyDate = today;
            stats.totalStudyMinutes += parseInt(duration);
            stats.sessionsCompleted += 1;

            // If a goal was linked, update its progress
            if (goalId && stats.goals) {
                const goal = stats.goals.id(goalId);
                if (goal) {
                    goal.completedMinutes += parseInt(duration);

                    // Check if newly completed
                    if (goal.completedMinutes >= goal.targetMinutes) {
                        goalCompleted = true;
                        goalTitle = goal.title;
                    }
                }
            }

            await stats.save();
        }

        res.status(201).json({
            success: true,
            data: session,
            goalCompleted,
            goalTitle
        });
    } catch (error) {
        console.error('Error logging study session:', error);
        res.status(500).json({ error: 'Failed to log study session' });
    }
};

/**
 * Get session history for the authenticated user
 */
export const getSessions = async (req, res) => {
    try {
        const userId = req.user._id;

        const sessions = await StudySession.find({ userId })
            .sort({ startTime: -1 })
            .limit(100);

        res.status(200).json({
            success: true,
            count: sessions.length,
            sessions: sessions // Frontend expects 'sessions'
        });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
};

/**
 * Get study analytics/stats for the authenticated user
 */
export const getStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // 1. Fetch or create high-level UserStats
        let stats = await UserStats.findOne({ userId });
        if (!stats) {
            stats = await UserStats.create({ userId });
        }

        // 2. Aggregate session totals
        const sessionStats = await StudySession.aggregate([
            { $match: { userId: userObjectId, type: 'study' } },
            {
                $group: {
                    _id: null,
                    totalDuration: { $sum: '$duration' },
                    totalSessions: { $sum: 1 }
                }
            }
        ]);

        // 3. Flashcard stats
        const flashcardCount = await FlashCard.countDocuments({ userId });
        const masteredCards = await FlashCard.countDocuments({ userId, masteryLevel: { $gte: 4 } });

        // 4. Question stats
        const questionCount = await Question.countDocuments({ userId });

        // 5. Daily stats for charts
        const daysParam = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysParam);

        const dailyStats = await StudySession.aggregate([
            {
                $match: {
                    userId: userObjectId,
                    type: 'study',
                    startTime: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                    minutes: { $sum: '$duration' }
                }
            },
            { $sort: { '_id': 1 } }
        ]);

        res.status(200).json({
            success: true,
            stats: {
                ...stats.toObject(),
                totalDuration: sessionStats[0]?.totalDuration || 0,
                totalSessions: sessionStats[0]?.totalSessions || 0,
                flashcardCount,
                masteredCards,
                questionCount
            },
            daily: dailyStats
        });
    } catch (error) {
        console.error('Error calculating stats:', error);
        res.status(500).json({ error: 'Failed to calculate stats' });
    }
};

/**
 * Manage Active Timer state
 */
export const getActiveTimer = async (req, res) => {
    try {
        const stats = await UserStats.findOne({ userId: req.user._id });
        res.json({ success: true, timer: stats?.activeTimer || null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch timer' });
    }
};

export const updateActiveTimer = async (req, res) => {
    try {
        const { timer } = req.body;
        await UserStats.findOneAndUpdate(
            { userId: req.user._id },
            { $set: { activeTimer: timer } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save timer' });
    }
};

export const deleteActiveTimer = async (req, res) => {
    try {
        await UserStats.findOneAndUpdate(
            { userId: req.user._id },
            { $unset: { activeTimer: "" } }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear timer' });
    }
};

/**
 * Manage Goals
 */
export const getGoals = async (req, res) => {
    try {
        const stats = await UserStats.findOne({ userId: req.user._id });
        res.json({ success: true, goals: stats?.goals || [] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch goals' });
    }
};

export const createGoal = async (req, res) => {
    try {
        const goal = req.body;
        const stats = await UserStats.findOneAndUpdate(
            { userId: req.user._id },
            { $push: { goals: goal } },
            { upsert: true, new: true }
        );
        res.json({ success: true, goals: stats.goals });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create goal' });
    }
};

export const deleteGoal = async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Goal ID required' });

        const stats = await UserStats.findOneAndUpdate(
            { userId: req.user._id },
            { $pull: { goals: { _id: new mongoose.Types.ObjectId(id) } } },
            { new: true }
        );
        res.json({ success: true, goals: stats?.goals || [] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete goal' });
    }
};

export const updateGoal = async (req, res) => {
    try {
        const { id } = req.query;
        const updates = req.body;

        let stats = await UserStats.findOne({ userId: req.user._id });
        if (stats) {
            const goal = stats.goals.id(id);
            if (goal) {
                // Update goal fields
                goal.set(updates);
                await stats.save();
            }
        }
        res.json({ success: true, goals: stats?.goals || [] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update goal' });
    }
};
