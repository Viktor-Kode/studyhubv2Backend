import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import CBTResult from '../models/CBTResult.js';
import StudySession from '../models/StudySession.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import Streak from '../models/Streak.js';
import StudyNote from '../models/StudyNote.js';
import { PLANS } from '../config/plans.js';

const userId = (id) => new mongoose.Types.ObjectId(id);

const todayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const weekStart = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return d;
};

const monthStart = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
};

export const getAdminStats = async (req, res) => {
    try {
        console.log('[Admin] Stats requested by:', req.user?.email || req.user?._id);

        const today = todayStart();
        const weekAgo = weekStart();
        const monthAgo = monthStart();

        const [
            userCounts,
            activeSubs,
            planCounts,
            revenueData,
            cbtStats,
            studyStats,
            flashStats,
            streakCount,
            noteCount,
            dailySignups,
            topSubjects,
            recentUsers,
            recentTransactions
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ subscriptionStatus: 'active' }),
            User.aggregate([
                { $match: { subscriptionStatus: 'active' } },
                { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } }
            ]),
            Transaction.aggregate([
                { $match: { status: 'success' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Promise.all([
                CBTResult.countDocuments(),
                CBTResult.countDocuments({ createdAt: { $gte: today } })
            ]),
            Promise.all([
                StudySession.countDocuments({ type: 'study' }),
                StudySession.countDocuments({ type: 'study', startTime: { $gte: today } })
            ]),
            FlashcardProgress.aggregate([
                { $group: { _id: null, total: { $sum: '$reviewCount' } } }
            ]),
            Streak.countDocuments({ currentStreak: { $gt: 0 } }),
            StudyNote.countDocuments(),
            User.aggregate([
                { $match: { createdAt: { $gte: weekAgo } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            CBTResult.aggregate([
                { $group: { _id: '$subject', count: { $sum: 1 }, avgAccuracy: { $avg: '$accuracy' } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            User.find()
                .sort({ createdAt: -1 })
                .limit(10)
                .select('name email subscriptionStatus subscriptionPlan createdAt role'),
            Transaction.find({ status: 'success' })
                .populate('userId', 'name email')
                .sort({ createdAt: -1 })
                .limit(10)
        ]);

        const usersToday = await User.countDocuments({ createdAt: { $gte: today } });
        const usersThisWeek = await User.countDocuments({ createdAt: { $gte: weekAgo } });
        const usersThisMonth = await User.countDocuments({ createdAt: { $gte: monthAgo } });

        const weeklyCount = planCounts.find(p => p._id === 'weekly')?.count || 0;
        const monthlyCount = planCounts.find(p => p._id === 'monthly')?.count || 0;
        console.log('[Admin] userCounts:', userCounts, 'cbt:', cbtStats, 'revenue:', revenueData);
        const totalUsers = Math.max(userCounts, 1);
        const conversionRate = ((activeSubs / totalUsers) * 100).toFixed(1);

        const revenueKobo = revenueData[0]?.total || 0;
        const revenueNaira = (revenueKobo / 100).toFixed(2);

        const stats = {
            users: {
                total: userCounts,
                today: usersToday,
                thisWeek: usersThisWeek,
                thisMonth: usersThisMonth,
                activeSubscriptions: activeSubs,
                weeklyPlans: weeklyCount,
                monthlyPlans: monthlyCount,
                conversionRate: conversionRate + '%'
            },
            revenue: {
                total: revenueKobo,
                formatted: `₦${Number(revenueNaira).toLocaleString()}`
            },
            activity: {
                totalCBT: cbtStats[0] || 0,
                cbtToday: cbtStats[1] || 0,
                totalStudySessions: studyStats[0] || 0,
                studySessionsToday: studyStats[1] || 0,
                totalFlashcardReviews: flashStats[0]?.total || 0,
                activeStreaks: streakCount,
                totalNotes: noteCount
            },
            charts: {
                dailySignups: dailySignups.map(d => ({ _id: d._id, count: d.count })),
                topSubjects: topSubjects.map(s => ({
                    _id: s._id,
                    count: s.count,
                    avgAccuracy: Math.round(s.avgAccuracy || 0)
                }))
            },
            recentUsers: recentUsers.map(u => ({
                _id: u._id,
                name: u.name,
                email: u.email,
                subscriptionStatus: u.subscriptionStatus,
                subscriptionPlan: u.subscriptionPlan,
                createdAt: u.createdAt,
                role: u.role
            })),
            recentTransactions: recentTransactions.map(t => ({
                _id: t._id,
                amount: t.amount,
                plan: t.plan,
                createdAt: t.createdAt,
                userId: t.userId ? { name: t.userId.name, email: t.userId.email } : undefined
            }))
        };

        console.log('[Admin] Stats built successfully');
        res.json({ success: true, stats });
    } catch (err) {
        console.error('[Admin] getAdminStats error:', err.message);
        console.error('[Admin] Stack:', err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getAdminUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const search = (req.query.search || '').trim();
        const status = req.query.status || '';

        const conditions = [];

        if (search) {
            conditions.push({
                $or: [
                    { email: { $regex: search, $options: 'i' } },
                    { name: { $regex: search, $options: 'i' } }
                ]
            });
        }

        if (status === 'active') {
            conditions.push({ subscriptionStatus: 'active' });
        } else if (status === 'free') {
            conditions.push({
                $or: [
                    { subscriptionStatus: 'free' },
                    { subscriptionStatus: { $exists: false } },
                    { subscriptionStatus: null }
                ]
            });
        } else if (status === 'expired') {
            conditions.push({ subscriptionStatus: 'expired' });
        }

        const filter = conditions.length > 0 ? { $and: conditions } : {};

        const [users, total] = await Promise.all([
            User.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('name email subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit createdAt role phoneNumber')
                .lean(),
            User.countDocuments(filter)
        ]);

        res.json({ success: true, users, total });
    } catch (err) {
        console.error('[Admin] getAdminUsers error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const grantPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { plan, days } = req.body;

        const planConfig = PLANS[plan] || PLANS.monthly;
        const durationDays = Math.max(1, parseInt(days) || planConfig.durationDays || 30);

        const now = new Date();
        const end = new Date(now);
        end.setDate(end.getDate() + durationDays);

        const updated = await User.findByIdAndUpdate(
            id,
            {
                $set: {
                    subscriptionStatus: 'active',
                    subscriptionPlan: plan,
                    subscriptionStart: now,
                    subscriptionEnd: end,
                    aiUsageCount: 0,
                    aiUsageLimit: planConfig.aiLimit,
                    flashcardUsageCount: 0,
                    flashcardUsageLimit: planConfig.flashcardLimit
                }
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({
            success: true,
            message: `Granted ${plan} plan for ${durationDays} days`,
            user: {
                email: updated.email,
                subscriptionPlan: updated.subscriptionPlan,
                subscriptionEnd: updated.subscriptionEnd
            }
        });
    } catch (err) {
        console.error('[Admin] grantPlan error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getOnlineUsers = async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const onlineUsers = await User.find({
            lastSeen: { $gte: fiveMinutesAgo }
        })
            .select('name email subscriptionStatus subscriptionPlan lastSeen avatar')
            .sort({ lastSeen: -1 })
            .lean();
        res.json({ success: true, users: onlineUsers, count: onlineUsers.length });
    } catch (err) {
        console.error('[Admin] getOnlineUsers error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Users who have been active (logged in) today, based on lastSeen
export const getTodayLogins = async (req, res) => {
    try {
        const startOfDay = todayStart();
        const users = await User.find({
            lastSeen: { $gte: startOfDay }
        })
            .select('name email subscriptionStatus subscriptionPlan lastSeen role avatar')
            .sort({ lastSeen: -1 })
            .lean();

        res.json({
            success: true,
            count: users.length,
            users
        });
    } catch (err) {
        console.error('[Admin] getTodayLogins error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getUserActivity = async (req, res) => {
    try {
        const { id } = req.params;

        const [
            user,
            cbtResults,
            studySessions,
            flashcardProgress,
            streak,
            notes,
            transactions
        ] = await Promise.all([
            User.findById(id)
                .select('name email phoneNumber subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit flashcardUsageCount flashcardUsageLimit createdAt lastSeen examTarget subjects avatar')
                .lean(),
            CBTResult.find({ studentId: userId(id) }).sort({ takenAt: -1 }).limit(20).lean(),
            StudySession.find({ userId: userId(id) }).sort({ startTime: -1 }).limit(20).lean(),
            FlashcardProgress.find({ studentId: userId(id) }).sort({ updatedAt: -1 }).limit(20).lean(),
            Streak.findOne({ studentId: userId(id) }).lean(),
            StudyNote.find({ userId: userId(id) }).sort({ createdAt: -1 }).limit(10).select('title subject createdAt').lean(),
            Transaction.find({ userId: userId(id) }).sort({ createdAt: -1 }).lean()
        ]);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // StudySession duration is in minutes
        const totalStudyTimeMinutes = studySessions.reduce((sum, s) => sum + (s.duration || 0), 0);
        const avgCBTAccuracy = cbtResults.length > 0
            ? Math.round(cbtResults.reduce((sum, r) => sum + (r.accuracy || 0), 0) / cbtResults.length)
            : 0;

        const subjectBreakdown = cbtResults.reduce((acc, r) => {
            const subj = r.subject || 'Unknown';
            if (!acc[subj]) acc[subj] = { count: 0, totalAccuracy: 0 };
            acc[subj].count++;
            acc[subj].totalAccuracy += r.accuracy || 0;
            return acc;
        }, {});

        const subjects = Object.entries(subjectBreakdown).map(([subject, data]) => ({
            subject,
            attempts: data.count,
            avgAccuracy: Math.round(data.totalAccuracy / data.count)
        })).sort((a, b) => b.attempts - a.attempts);

        res.json({
            success: true,
            user,
            stats: {
                totalCBT: cbtResults.length,
                avgCBTAccuracy,
                totalStudyTime: totalStudyTimeMinutes,
                totalNotes: notes.length,
                totalTransactions: transactions.length,
                currentStreak: streak?.currentStreak || 0,
                longestStreak: streak?.longestStreak || 0,
                flashcardsReviewed: flashcardProgress.length,
                subjectBreakdown: subjects
            },
            recentCBT: cbtResults.slice(0, 10),
            recentSessions: studySessions.slice(0, 10).map(s => ({
                ...s,
                subject: s.title,
                durationSeconds: (s.duration || 0) * 60,
                createdAt: s.startTime || s.createdAt
            })),
            notes,
            transactions
        });
    } catch (err) {
        console.error('[Admin] getUserActivity error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getMetricUsers = async (req, res) => {
    try {
        const { metric, filter } = req.query;
        const today = todayStart();
        let users = [];

        if (metric === 'cbt') {
            const match = filter === 'today' ? { takenAt: { $gte: today } } : {};
            const results = await CBTResult.find(match)
                .sort({ takenAt: -1 })
                .populate('studentId', 'name email subscriptionStatus subscriptionPlan avatar lastSeen')
                .lean();

            const userMap = {};
            results.forEach(r => {
                if (!r.studentId) return;
                const uid = r.studentId._id.toString();
                if (!userMap[uid]) {
                    userMap[uid] = {
                        user: r.studentId,
                        count: 0,
                        lastActivity: r.takenAt,
                        details: []
                    };
                }
                userMap[uid].count++;
                userMap[uid].lastActivity = r.takenAt;
                userMap[uid].details.push({
                    subject: r.subject,
                    accuracy: r.accuracy,
                    total: r.totalQuestions,
                    date: r.takenAt
                });
            });
            users = Object.values(userMap).sort((a, b) =>
                new Date(b.lastActivity) - new Date(a.lastActivity)
            );
        } else if (metric === 'sessions') {
            const match = filter === 'today'
                ? { type: 'study', startTime: { $gte: today } }
                : { type: 'study' };

            const sessions = await StudySession.find(match)
                .sort({ startTime: -1 })
                .populate('userId', 'name email subscriptionStatus subscriptionPlan avatar lastSeen')
                .lean();

            const userMap = {};
            sessions.forEach(s => {
                if (!s.userId) return;
                const uid = s.userId._id.toString();
                if (!userMap[uid]) {
                    userMap[uid] = {
                        user: s.userId,
                        count: 0,
                        totalMinutes: 0,
                        lastActivity: s.startTime || s.createdAt,
                        details: []
                    };
                }
                userMap[uid].count++;
                userMap[uid].totalMinutes += s.duration || 0;
                userMap[uid].lastActivity = s.startTime || s.createdAt;
                userMap[uid].details.push({
                    subject: s.title || 'General',
                    duration: s.duration || 0,
                    date: s.startTime || s.createdAt
                });
            });
            users = Object.values(userMap).sort((a, b) =>
                new Date(b.lastActivity) - new Date(a.lastActivity)
            );
        } else if (metric === 'flashcards') {
            const reviewed = await FlashcardProgress.find({ reviewCount: { $gt: 0 } })
                .sort({ updatedAt: -1 })
                .populate('studentId', 'name email subscriptionStatus subscriptionPlan avatar lastSeen')
                .lean();

            const userMap = {};
            reviewed.forEach(f => {
                if (!f.studentId) return;
                const uid = f.studentId._id.toString();
                if (!userMap[uid]) {
                    userMap[uid] = {
                        user: f.studentId,
                        count: 0,
                        mastered: 0,
                        lastActivity: f.updatedAt || f.lastReviewed,
                        details: []
                    };
                }
                userMap[uid].count += f.reviewCount || 0;
                if (f.status === 'mastered') userMap[uid].mastered++;
            });
            users = Object.values(userMap).sort((a, b) =>
                new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0)
            );
        } else if (metric === 'streaks') {
            const streaks = await Streak.find({ currentStreak: { $gt: 0 } })
                .sort({ currentStreak: -1 })
                .populate('studentId', 'name email subscriptionStatus subscriptionPlan avatar lastSeen')
                .lean();

            users = streaks
                .filter(s => s.studentId)
                .map(s => ({
                    user: s.studentId,
                    count: s.currentStreak,
                    longestStreak: s.longestStreak || 0,
                    lastActivity: s.lastActivityDate,
                    details: []
                }));
        }

        res.json({ success: true, users, metric, filter });
    } catch (err) {
        console.error('[Admin] getMetricUsers error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user._id.toString() === id) {
            return res.status(400).json({ success: false, error: 'You cannot delete yourself' });
        }

        const deleted = await User.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        console.error('[Admin] deleteUser error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
