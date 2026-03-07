import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import CBTResult from '../models/CBTResult.js';
import StudySession from '../models/StudySession.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import Streak from '../models/Streak.js';
import StudyNote from '../models/StudyNote.js';
import { PLANS } from '../config/plans.js';

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
