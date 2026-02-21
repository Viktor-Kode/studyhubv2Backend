import StudySession from '../models/StudySession.js';
import mongoose from 'mongoose';

/**
 * Log a new study session
 */
export const createSession = async (req, res) => {
    try {
        // Use authenticated user ID from JWT (not from request body)
        const userId = req.user._id.toString();
        const { title, type, duration, startTime, endTime, notes } = req.body;

        if (!duration) {
            return res.status(400).json({ error: 'Duration is required' });
        }

        const session = new StudySession({
            userId,
            title: title || (type === 'break' ? 'Short Break' : 'Productive Session'),
            type: type || 'study',
            duration,
            startTime: startTime || new Date(),
            endTime: endTime || new Date(),
            notes
        });

        await session.save();

        res.status(201).json({
            success: true,
            data: session
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
        const userId = req.user._id.toString();

        const sessions = await StudySession.find({ userId })
            .sort({ startTime: -1 })
            .limit(100);

        res.status(200).json({
            success: true,
            count: sessions.length,
            data: sessions
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
        const userId = req.user._id.toString();
        const daysParam = parseInt(req.query.days) || 30;

        // Convert userId string to ObjectId for aggregation
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Aggregate overall stats
        const stats = await StudySession.aggregate([
            { $match: { userId: userObjectId, type: 'study' } },
            {
                $group: {
                    _id: null,
                    totalMinutes: { $sum: '$duration' },
                    sessionCount: { $sum: 1 },
                    averageDuration: { $avg: '$duration' }
                }
            }
        ]);

        // Get daily stats for the requested date range
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
            overall: stats[0] || { totalMinutes: 0, sessionCount: 0, averageDuration: 0 },
            daily: dailyStats
        });
    } catch (error) {
        console.error('Error calculating stats:', error);
        res.status(500).json({ error: 'Failed to calculate stats' });
    }
};
