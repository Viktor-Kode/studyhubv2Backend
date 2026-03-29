import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import CBTResult from '../models/CBTResult.js';
import StudySession from '../models/StudySession.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import Streak from '../models/Streak.js';
import StudyNote from '../models/StudyNote.js';
import QuizSession from '../models/QuizSession.js';
import FlashCardDeck from '../models/FlashCardDeck.js';
import Class from '../models/Class.js';
import Reminder from '../models/Reminder.js';
import LibraryMaterial from '../models/LibraryMaterial.js';
import UserProgress from '../models/UserProgress.js';
import UserDailyActivity from '../models/UserDailyActivity.js';
import ChatHistory from '../models/ChatHistory.js';
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
            recentTransactions,
            quizSessionCounts,
            flashcardDeckCount,
            classCount,
            reminderCount
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
                .limit(10),
            Promise.all([
                QuizSession.countDocuments(),
                QuizSession.countDocuments({ createdAt: { $gte: today } })
            ]),
            FlashCardDeck.countDocuments(),
            Class.countDocuments(),
            Reminder.countDocuments()
        ]);

        const usersToday = await User.countDocuments({ createdAt: { $gte: today } });
        const usersThisWeek = await User.countDocuments({ createdAt: { $gte: weekAgo } });
        const usersThisMonth = await User.countDocuments({ createdAt: { $gte: monthAgo } });

        const dailyCount = planCounts.find(p => p._id === 'daily')?.count || 0;
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
                dailyPlans: dailyCount,
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
            })),
            extra: {
                quizzes: {
                    totalSessions: quizSessionCounts?.[0] || 0,
                    sessionsToday: quizSessionCounts?.[1] || 0
                },
                content: {
                    totalNotes: noteCount,
                    flashcardDecks: flashcardDeckCount || 0
                },
                classes: {
                    totalClasses: classCount || 0,
                    totalReminders: reminderCount || 0
                }
            }
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
        const plan = (req.query.plan || '').trim();
        const sort = (req.query.sort || 'newest').trim();

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

        if (plan === 'daily') {
            conditions.push({ subscriptionPlan: 'daily', subscriptionStatus: 'active' });
        } else if (plan === 'weekly') {
            conditions.push({ subscriptionPlan: 'weekly', subscriptionStatus: 'active' });
        } else if (plan === 'monthly') {
            conditions.push({ subscriptionPlan: 'monthly', subscriptionStatus: 'active' });
        } else if (plan === 'free') {
            conditions.push({
                $or: [
                    { subscriptionStatus: { $ne: 'active' } },
                    { subscriptionPlan: null },
                    { subscriptionStatus: 'free' },
                    { subscriptionStatus: 'expired' }
                ]
            });
        } else if (plan === 'teacher') {
            conditions.push({ role: 'teacher' });
        }

        const filter = conditions.length > 0 ? { $and: conditions } : {};

        const sortObj =
            sort === 'oldest' ? { createdAt: 1 } :
                sort === 'name' ? { name: 1 } :
                    { createdAt: -1 };

        const [users, total] = await Promise.all([
            User.find(filter)
                .sort(sortObj)
                .skip((page - 1) * limit)
                .limit(limit)
                .select(
                    'name email subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit createdAt role phoneNumber teacherPlan teacherPlanEnd lastSeen banned firebaseUid isVerified'
                )
                .lean(),
            User.countDocuments(filter)
        ]);

        res.json({
            success: true,
            users,
            total,
            pages: Math.ceil(total / limit) || 1
        });
    } catch (err) {
        console.error('[Admin] getAdminUsers error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const ADMIN_GRANT_PLANS = ['daily', 'weekly', 'monthly'];

export const grantPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { plan, days } = req.body;

        const planKey = ADMIN_GRANT_PLANS.includes(plan) ? plan : 'monthly';
        const planConfig = PLANS[planKey];
        const durationDays = Math.max(1, parseInt(days, 10) || planConfig.durationDays || 30);

        const now = new Date();
        const end = new Date(now);
        end.setDate(end.getDate() + durationDays);

        const updated = await User.findByIdAndUpdate(
            id,
            {
                $set: {
                    subscriptionStatus: 'active',
                    subscriptionPlan: planKey,
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
            message: `Granted ${planKey} plan for ${durationDays} days`,
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

// Paginated logins list based on users seen in dashboard/auth middleware.
export const getDashboardLogins = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const search = String(req.query.search || '').trim();

        const filter = { lastSeen: { $ne: null } };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
            ];
        }

        const [users, total] = await Promise.all([
            User.find(filter)
                .select('name email role subscriptionStatus subscriptionPlan lastSeen isVerified')
                .sort({ lastSeen: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            User.countDocuments(filter),
        ]);

        res.json({
            success: true,
            users,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
        });
    } catch (err) {
        console.error('[Admin] getDashboardLogins error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const setUserVerification = async (req, res) => {
    try {
        const { id } = req.params;
        const { isVerified } = req.body || {};
        if (typeof isVerified !== 'boolean') {
            return res.status(400).json({ success: false, error: 'isVerified must be boolean' });
        }

        const user = await User.findByIdAndUpdate(
            id,
            { $set: { isVerified } },
            { new: true }
        ).select('name email role isVerified');

        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        res.json({ success: true, user });
    } catch (err) {
        console.error('[Admin] setUserVerification error:', err);
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

/** UTC day bounds for YYYY-MM-DD */
const utcDayBounds = (dayKey) => {
    const start = new Date(`${dayKey}T00:00:00.000Z`);
    const end = new Date(`${dayKey}T23:59:59.999Z`);
    return { start, end };
};

export const getUserActivityDays = async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Math.min(365, Math.max(1, parseInt(req.query.limit, 10) || 120));

        const exists = await User.findById(id).select('_id').lean();
        if (!exists) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const rows = await UserDailyActivity.find({ userId: userId(id) })
            .sort({ dayKey: -1 })
            .limit(limit)
            .select('dayKey firstAt lastAt')
            .lean();

        res.json({
            success: true,
            days: rows.map((r) => ({
                dayKey: r.dayKey,
                firstAt: r.firstAt,
                lastAt: r.lastAt
            }))
        });
    } catch (err) {
        console.error('[Admin] getUserActivityDays error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Per-day merged timeline: session pings (from auth middleware) plus product events
 * (CBT, study, quizzes, payments, notes, flashcards, reminders, library, AI chats).
 */
export const getUserActivityDay = async (req, res) => {
    try {
        const { id } = req.params;
        const raw = String(req.query.date || '').trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date. Use date=YYYY-MM-DD (UTC calendar day).'
            });
        }

        const { start, end } = utcDayBounds(raw);
        const uid = userId(id);

        const user = await User.findById(id).select('name email').lean();
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const [
            dailyPing,
            cbt,
            studySessions,
            quizSessions,
            transactions,
            notes,
            flashRows,
            reminders,
            chats,
            libraryDocs
        ] = await Promise.all([
            UserDailyActivity.findOne({ userId: uid, dayKey: raw }).lean(),
            CBTResult.find({ studentId: uid, takenAt: { $gte: start, $lte: end } })
                .sort({ takenAt: 1 })
                .lean(),
            StudySession.find({ userId: uid, startTime: { $gte: start, $lte: end } })
                .sort({ startTime: 1 })
                .lean(),
            QuizSession.find({ userId: uid, createdAt: { $gte: start, $lte: end } })
                .sort({ createdAt: 1 })
                .lean(),
            Transaction.find({ userId: uid, createdAt: { $gte: start, $lte: end } })
                .sort({ createdAt: 1 })
                .lean(),
            StudyNote.find({ userId: uid, createdAt: { $gte: start, $lte: end } })
                .sort({ createdAt: 1 })
                .select('title subject createdAt')
                .lean(),
            FlashcardProgress.find({
                studentId: uid,
                $or: [
                    { updatedAt: { $gte: start, $lte: end } },
                    { lastReviewed: { $gte: start, $lte: end } }
                ]
            })
                .sort({ updatedAt: 1 })
                .limit(400)
                .lean(),
            Reminder.find({ userId: uid, createdAt: { $gte: start, $lte: end } })
                .sort({ createdAt: 1 })
                .lean(),
            ChatHistory.find({ userId: uid, updatedAt: { $gte: start, $lte: end } })
                .sort({ updatedAt: 1 })
                .select('title subject updatedAt')
                .lean(),
            LibraryMaterial.find({
                userId: uid,
                $or: [
                    { createdAt: { $gte: start, $lte: end } },
                    { updatedAt: { $gte: start, $lte: end } }
                ]
            })
                .sort({ updatedAt: 1 })
                .limit(200)
                .lean()
        ]);

        const timeline = [];

        if (dailyPing) {
            timeline.push({
                at: dailyPing.firstAt,
                kind: 'app_session',
                label: 'First authenticated activity (session start)',
                detail: { lastAt: dailyPing.lastAt }
            });
            if (
                dailyPing.lastAt &&
                dailyPing.firstAt &&
                new Date(dailyPing.lastAt).getTime() - new Date(dailyPing.firstAt).getTime() > 60 * 1000
            ) {
                timeline.push({
                    at: dailyPing.lastAt,
                    kind: 'app_session',
                    label: 'Last authenticated activity',
                    detail: {}
                });
            }
        }

        cbt.forEach((r) => {
            timeline.push({
                at: r.takenAt,
                kind: 'cbt',
                label: `CBT · ${r.subject || 'Practice'} (${r.examType || '—'})`,
                detail: {
                    accuracy: r.accuracy,
                    questions: r.totalQuestions,
                    id: r._id
                }
            });
        });

        studySessions.forEach((s) => {
            timeline.push({
                at: s.startTime || s.createdAt,
                kind: 'study',
                label: `${s.type === 'break' ? 'Break' : 'Study'} · ${s.title || 'Session'}`,
                detail: { minutes: s.duration, id: s._id }
            });
        });

        quizSessions.forEach((q) => {
            timeline.push({
                at: q.createdAt,
                kind: 'quiz',
                label: `Quiz · ${q.title || 'Session'} (${q.questionCount ?? 0} Q)`,
                detail: { questionType: q.questionType, id: q._id }
            });
        });

        transactions.forEach((t) => {
            timeline.push({
                at: t.createdAt,
                kind: 'payment',
                label: `Payment · ${t.plan || 'plan'} (${t.status || '—'})`,
                detail: {
                    amount: t.amount,
                    reference: t.reference,
                    id: t._id
                }
            });
        });

        notes.forEach((n) => {
            timeline.push({
                at: n.createdAt,
                kind: 'note',
                label: `Note · ${n.title || 'Untitled'}${n.subject ? ` (${n.subject})` : ''}`,
                detail: { id: n._id }
            });
        });

        flashRows.forEach((f) => {
            const at = f.lastReviewed && new Date(f.lastReviewed) >= start && new Date(f.lastReviewed) <= end
                ? f.lastReviewed
                : f.updatedAt;
            timeline.push({
                at,
                kind: 'flashcard',
                label: `Flashcard review · ${f.topic || f.subject || 'card'}`,
                detail: { status: f.status, reviewCount: f.reviewCount, id: f._id }
            });
        });

        reminders.forEach((r) => {
            timeline.push({
                at: r.createdAt,
                kind: 'reminder',
                label: `Reminder created · ${r.title}`,
                detail: { type: r.type, id: r._id }
            });
        });

        chats.forEach((c) => {
            timeline.push({
                at: c.updatedAt,
                kind: 'ai_chat',
                label: `AI chat · ${c.title || 'Chat'}${c.subject ? ` · ${c.subject}` : ''}`,
                detail: { id: c._id }
            });
        });

        libraryDocs.forEach((l) => {
            if (l.createdAt >= start && l.createdAt <= end) {
                timeline.push({
                    at: l.createdAt,
                    kind: 'library',
                    label: `Library added · ${l.title}`,
                    detail: { id: l._id }
                });
            }
            if (
                l.updatedAt &&
                l.updatedAt > l.createdAt &&
                l.updatedAt >= start &&
                l.updatedAt <= end
            ) {
                timeline.push({
                    at: l.updatedAt,
                    kind: 'library',
                    label: `Library activity · ${l.title}`,
                    detail: { id: l._id, readProgress: l.readProgress }
                });
            }
        });

        timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

        res.json({
            success: true,
            user,
            date: raw,
            dayBoundaryUtc: true,
            dailySession: dailyPing
                ? { firstAt: dailyPing.firstAt, lastAt: dailyPing.lastAt, dayKey: dailyPing.dayKey }
                : null,
            timeline,
            counts: {
                cbt: cbt.length,
                studySessions: studySessions.length,
                quizzes: quizSessions.length,
                payments: transactions.length,
                notes: notes.length,
                flashcards: flashRows.length,
                reminders: reminders.length,
                aiChats: chats.length,
                library: libraryDocs.length
            }
        });
    } catch (err) {
        console.error('[Admin] getUserActivityDay error:', err);
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

const csvEscape = (val) => {
    const s = String(val ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

// ── Full dashboard stats (admin UI v2) ───────────────────────────────────────
export const getFullDashboardStats = async (req, res) => {
    try {
        const now = new Date();
        const todayStartD = new Date(now);
        todayStartD.setHours(0, 0, 0, 0);
        const weekStartD = new Date(now);
        weekStartD.setDate(weekStartD.getDate() - 7);
        weekStartD.setHours(0, 0, 0, 0);
        const monthStartD = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStartD.setHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const eightyFourDaysAgo = new Date(now);
        eightyFourDaysAgo.setDate(eightyFourDaysAgo.getDate() - 84);

        const txSuccess = { status: 'success' };

        const [
            totalUsers,
            todayUsers,
            weekUsers,
            monthUsers,
            paidUsers,
            teacherUsers,
            totalRevenue,
            weekRevenue,
            monthRevenue,
            revenueByPlan,
            weeklyRevenueAgg,
            userGrowth,
            totalCBT,
            weekCBT,
            avgAccuracy,
            totalFiles,
            totalStorageAgg,
            failedPayments,
            aiUsageAgg,
            libByRole
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ createdAt: { $gte: todayStartD } }),
            User.countDocuments({ createdAt: { $gte: weekStartD } }),
            User.countDocuments({ createdAt: { $gte: monthStartD } }),
            User.countDocuments({ subscriptionStatus: 'active' }),
            User.countDocuments({ role: 'teacher' }),
            Transaction.aggregate([
                { $match: txSuccess },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Transaction.aggregate([
                { $match: { ...txSuccess, createdAt: { $gte: weekStartD } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Transaction.aggregate([
                { $match: { ...txSuccess, createdAt: { $gte: monthStartD } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Transaction.aggregate([
                { $match: txSuccess },
                { $group: { _id: '$plan', total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            Transaction.aggregate([
                { $match: { ...txSuccess, createdAt: { $gte: eightyFourDaysAgo } } },
                {
                    $group: {
                        _id: { y: { $isoWeekYear: '$createdAt' }, w: { $isoWeek: '$createdAt' } },
                        total: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.y': 1, '_id.w': 1 } }
            ]),
            User.aggregate([
                { $match: { createdAt: { $gte: thirtyDaysAgo } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            CBTResult.countDocuments(),
            CBTResult.countDocuments({ createdAt: { $gte: weekStartD } }),
            CBTResult.aggregate([{ $group: { _id: null, avg: { $avg: '$accuracy' } } }]),
            LibraryMaterial.countDocuments(),
            LibraryMaterial.aggregate([{ $group: { _id: null, total: { $sum: '$fileSize' } } }]),
            Transaction.countDocuments({ status: 'failed' }),
            User.aggregate([{ $group: { _id: null, total: { $sum: '$aiUsageCount' } } }]),
            LibraryMaterial.aggregate([
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'u'
                    }
                },
                { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: { $ifNull: ['$u.role', 'unknown'] },
                        bytes: { $sum: '$fileSize' },
                        files: { $sum: 1 }
                    }
                }
            ])
        ]);

        const freeUsers = Math.max(0, totalUsers - paidUsers);

        const topStudents = await UserProgress.find()
            .sort({ xp: -1 })
            .limit(10)
            .lean();
        const progressIds = topStudents.map((s) => s.userId).filter(Boolean);
        const topStudentUsers = await User.find({ firebaseUid: { $in: progressIds } })
            .select('firebaseUid name email subscriptionPlan subscriptionStatus role teacherPlan')
            .lean();
        const topStudentMap = Object.fromEntries(topStudentUsers.map((u) => [u.firebaseUid, u]));
        const topStudentsData = topStudents.map((s) => ({
            ...s,
            user: topStudentMap[s.userId] || null
        }));

        const teacherUsageRows = await User.find({ teacherUsage: { $exists: true } })
            .select('teacherUsage')
            .lean();
        const teacherToolTotals = {};
        for (const row of teacherUsageRows) {
            if (!row.teacherUsage) continue;
            for (const [k, v] of Object.entries(row.teacherUsage)) {
                teacherToolTotals[k] = (teacherToolTotals[k] || 0) + (Number(v) || 0);
            }
        }

        const weeklyRevenue = weeklyRevenueAgg.map((r) => ({
            _id: `W${r._id.w}`,
            y: r._id.y,
            w: r._id.w,
            total: r.total,
            count: r.count
        }));

        res.json({
            users: {
                total: totalUsers,
                today: todayUsers,
                week: weekUsers,
                month: monthUsers,
                paid: paidUsers,
                free: freeUsers,
                teachers: teacherUsers
            },
            revenue: {
                total: totalRevenue[0]?.total || 0,
                week: weekRevenue[0]?.total || 0,
                month: monthRevenue[0]?.total || 0,
                byPlan: revenueByPlan,
                weekly: weeklyRevenue
            },
            cbt: {
                total: totalCBT,
                week: weekCBT,
                avgScore: Math.round(avgAccuracy[0]?.avg || 0)
            },
            library: {
                files: totalFiles,
                storage: totalStorageAgg[0]?.total || 0,
                byRole: libByRole
            },
            failedPayments,
            topStudents: topStudentsData,
            userGrowth,
            teacherToolTotals,
            aiUsageTotal: aiUsageAgg[0]?.total || 0
        });
    } catch (err) {
        console.error('[Admin Stats]', err);
        res.status(500).json({ error: err.message });
    }
};

export const getActivityFeed = async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const pool = 120;

        const [recentUsers, recentPayments] = await Promise.all([
            User.find()
                .sort({ createdAt: -1 })
                .limit(pool)
                .select('name email subscriptionPlan subscriptionStatus createdAt')
                .lean(),
            Transaction.find()
                .sort({ createdAt: -1 })
                .limit(pool)
                .populate('userId', 'name email')
                .lean()
        ]);

        const feed = [
            ...recentUsers.map((u) => ({
                type: 'signup',
                time: u.createdAt,
                message: `${u.name || u.email} signed up`,
                plan: u.subscriptionPlan,
                icon: '👤'
            })),
            ...recentPayments.map((t) => {
                const email = t.userId?.email || 'Unknown';
                const naira = t.amount != null ? Math.round(t.amount / 100).toLocaleString('en-NG') : '0';
                return {
                    type: t.status === 'failed' ? 'failed_payment' : 'payment',
                    time: t.createdAt,
                    message: `${email} — ₦${naira} (${t.plan})`,
                    status: t.status,
                    icon: t.status === 'failed' ? '❌' : '💰'
                };
            })
        ].sort((a, b) => new Date(b.time) - new Date(a.time));

        const slice = feed.slice(offset, offset + limit);
        res.json({
            feed: slice,
            total: feed.length,
            hasMore: offset + limit < feed.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const adminQuickAction = async (req, res) => {
    try {
        const { action, userId, data } = req.body;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }

        if (action === 'ban_user') {
            await User.findByIdAndUpdate(userId, { banned: true });
            return res.json({ success: true, message: 'User banned' });
        }
        if (action === 'unban_user') {
            await User.findByIdAndUpdate(userId, { banned: false });
            return res.json({ success: true, message: 'User unbanned' });
        }
        if (action === 'give_free_access') {
            const planKey = ADMIN_GRANT_PLANS.includes(data?.plan) ? data.plan : 'monthly';
            const planConfig = PLANS[planKey];
            const defaultDays = planConfig?.durationDays || 30;
            const days = Math.max(1, parseInt(data?.days, 10) || defaultDays);
            const start = new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + days);

            await User.findByIdAndUpdate(userId, {
                subscriptionStatus: 'active',
                subscriptionPlan: planKey,
                subscriptionStart: start,
                subscriptionEnd: end,
                aiUsageCount: 0,
                aiUsageLimit: planConfig.aiLimit,
                flashcardUsageCount: 0,
                flashcardUsageLimit: planConfig.flashcardLimit
            });
            return res.json({
                success: true,
                message: `Free ${planKey} access given for ${days} day${days === 1 ? '' : 's'}`
            });
        }
        if (action === 'revoke_gifted_access') {
            const freeConfig = PLANS.free;
            const updated = await User.findByIdAndUpdate(
                userId,
                {
                    $set: {
                        subscriptionStatus: 'free',
                        subscriptionPlan: null,
                        subscriptionStart: null,
                        subscriptionEnd: null,
                        aiUsageCount: 0,
                        aiUsageLimit: freeConfig.aiLimit,
                        flashcardUsageCount: 0,
                        flashcardUsageLimit: freeConfig.flashcardLimit
                    }
                },
                { new: true }
            );
            if (!updated) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            return res.json({
                success: true,
                message: 'Student plan access removed; user is on the free tier'
            });
        }
        if (action === 'reset_password') {
            return res.json({
                success: true,
                message: 'Send password reset from Firebase console'
            });
        }

        res.status(400).json({ success: false, error: 'Unknown action' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const exportUsersCSV = async (req, res) => {
    try {
        const users = await User.find()
            .select('name email subscriptionStatus subscriptionPlan createdAt phoneNumber teacherPlan role lastSeen')
            .sort({ createdAt: -1 })
            .lean();

        const rows = [
            ['Name', 'Email', 'Phone', 'Plan', 'Status', 'Teacher Plan', 'Role', 'Joined', 'Last seen'].map(csvEscape).join(','),
            ...users.map((u) =>
                [
                    csvEscape(u.name || ''),
                    csvEscape(u.email || ''),
                    csvEscape(u.phoneNumber || ''),
                    csvEscape(u.subscriptionPlan || 'free'),
                    csvEscape(u.subscriptionStatus || ''),
                    csvEscape(u.teacherPlan || 'none'),
                    csvEscape(u.role || 'student'),
                    csvEscape(new Date(u.createdAt).toLocaleDateString('en-NG')),
                    csvEscape(u.lastSeen ? new Date(u.lastSeen).toLocaleDateString('en-NG') : '')
                ].join(',')
            )
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=studyhelp_users.csv');
        res.send(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
