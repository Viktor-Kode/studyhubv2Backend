import mongoose from 'mongoose';
import UserProgress from '../models/UserProgress.js';
import User from '../models/User.js';
import { XP_REWARDS, getLevelFromXP, checkBadges, BADGES } from '../config/gamification.js';

const getWeekStart = (date) => {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
};

function userExamLabel(user) {
    const s = user?.settings;
    if (!s || typeof s !== 'object') return null;
    return s.examTarget || s.exam || s.profile?.examTarget || null;
}

function userSubjects(user) {
    const s = user?.settings;
    if (!s || typeof s !== 'object') return [];
    const list = s.subjects || s.profile?.subjects;
    return Array.isArray(list) ? list : [];
}

function normalizeExam(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function subjectMatches(user, subjectFilter) {
    if (!subjectFilter) return true;
    const subs = userSubjects(user);
    const want = String(subjectFilter).trim().toLowerCase();
    return subs.some((x) => String(x).trim().toLowerCase() === want);
}

function pushBadgeDefs(progress, defs) {
    for (const b of defs) {
        if (!b || progress.badges.some((x) => x.id === b.id)) continue;
        progress.badges.push({
            id: b.id,
            name: b.name,
            description: b.description,
            icon: b.icon,
        });
    }
}

async function tryGrantTop10Badge(userIdStr, rankInBoard) {
    if (!rankInBoard || rankInBoard > 10) return;
    const progress = await UserProgress.findOne({ userId: userIdStr });
    if (!progress) return;
    const def = BADGES.find((b) => b.id === 'top_10');
    if (!def || progress.badges.some((b) => b.id === 'top_10')) return;
    progress.badges.push({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
    });
    await progress.save();
}

export const awardXP = async (userId, action, metadata = {}) => {
    try {
        let xpToAdd = typeof action === 'number' ? action : (metadata?.amount != null ? metadata.amount : (XP_REWARDS[action] || 0));
        if (!xpToAdd) return null;

        let targetUserId = String(userId);
        let progress = await UserProgress.findOne({ userId: targetUserId });
        if (!progress) {
            const userDoc = await User.findOne({
                $or: [
                    { firebaseUid: targetUserId },
                    ...(mongoose.Types.ObjectId.isValid(targetUserId) ? [{ _id: targetUserId }] : [])
                ]
            });
            if (userDoc) {
                targetUserId = String(userDoc._id);
                progress = await UserProgress.findOne({ userId: targetUserId });
            }
        }
        if (!progress) progress = new UserProgress({ userId: targetUserId });

        const now = new Date();
        const weekStart = getWeekStart(now);
        if (progress.weekStart !== weekStart) {
            progress.weeklyXP = 0;
            progress.weekStart = weekStart;
            progress.weekDaysActive = [];
        }

        const todayStr = now.toISOString().split('T')[0];
        if (progress.dayStart !== todayStr) {
            progress.dailyXP = 0;
            progress.dayStart = todayStr;
        }

        // Track active day of week (0=Mon ... 6=Sun)
        const jsDay = now.getDay();
        const dayIndex = (jsDay + 6) % 7;
        if (!Array.isArray(progress.weekDaysActive)) {
            progress.weekDaysActive = [];
        }
        if (!progress.weekDaysActive.includes(dayIndex)) {
            progress.weekDaysActive.push(dayIndex);
        }

        if (action === 'daily_login') {
            const today = now.toISOString().split('T')[0];
            if (progress.lastLoginDate === today) return null;
            const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
            progress.streak = progress.lastLoginDate === yesterday ? progress.streak + 1 : 1;
            progress.lastLoginDate = today;
            if (progress.streak === 7) xpToAdd += XP_REWARDS.streak_7_days;
        }

        if (action === 'cbt_complete') progress.totalCBTDone += 1;
        if (action === 'study_question') progress.totalQuestionsAnswered += 1;
        if (action === 'syllabus_topic') progress.totalTopicsStudied += 1;
        if (action === 'cbt_high_score') {
            progress.highScoreCBTCount = (progress.highScoreCBTCount || 0) + 1;
        }

        if (action === 'library_upvote') {
            const today = now.toISOString().split('T')[0];
            if (progress.lastLibraryUpvoteDay === today) return null;
            progress.lastLibraryUpvoteDay = today;
        }

        if (action === 'pomodoro_streak_daily') {
            const today = now.toISOString().split('T')[0];
            if (progress.lastPomodoroDailyBonusDay === today) return null;
            progress.lastPomodoroDailyBonusDay = today;
        }

        progress.xp += xpToAdd;
        progress.weeklyXP += xpToAdd;
        progress.dailyXP = (progress.dailyXP || 0) + xpToAdd;

        const levelInfo = getLevelFromXP(progress.xp);
        progress.level = levelInfo.level;
        progress.levelName = levelInfo.name;

        const newBadgeDefs = checkBadges(progress);
        if (newBadgeDefs.length) pushBadgeDefs(progress, newBadgeDefs);

        await progress.save();
        return {
            xpAdded: xpToAdd,
            newBadges: newBadgeDefs,
            progress,
        };
    } catch (err) {
        console.error('[XP Award Error]', err.message);
        return null;
    }
};

export const getMyProgress = async (req, res) => {
    try {
        const userId = String(req.user._id);
        let progress = await UserProgress.findOne({ userId });
        if (!progress && req.user?.firebaseUid) {
            progress = await UserProgress.findOne({ userId: req.user.firebaseUid });
            if (progress) {
                progress.userId = userId;
                await progress.save();
            }
        }
        if (!progress) {
            progress = new UserProgress({ userId });
            await progress.save();
        }

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const weekStart = getWeekStart(now);
        let modified = false;

        if (progress.weekStart !== weekStart) {
            progress.weeklyXP = 0;
            progress.weekStart = weekStart;
            progress.weekDaysActive = [];
            modified = true;
        }

        if (progress.dayStart !== todayStr) {
            progress.dailyXP = 0;
            progress.dayStart = todayStr;
            modified = true;
        }

        // If user already has streak active or login recorded today, ensure today is marked active
        const jsDay = now.getDay();
        const dayIndex = (jsDay + 6) % 7;
        if (!Array.isArray(progress.weekDaysActive)) {
            progress.weekDaysActive = [];
            modified = true;
        }
        if (progress.lastLoginDate === todayStr && !progress.weekDaysActive.includes(dayIndex)) {
            progress.weekDaysActive.push(dayIndex);
            modified = true;
        }

        if (modified) {
            await progress.save();
        }

        const levelInfo = getLevelFromXP(progress.xp);
        res.json({ ...progress.toObject(), levelInfo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateDailyGoalTarget = async (req, res) => {
    try {
        const userId = String(req.user._id);
        const { dailyGoalTarget } = req.body;
        const target = Math.max(10, Math.min(500, Number(dailyGoalTarget) || 50));
        let progress = await UserProgress.findOne({ userId });
        if (!progress) {
            progress = new UserProgress({ userId });
        }
        progress.dailyGoalTarget = target;
        await progress.save();
        res.json({ success: true, dailyGoalTarget: progress.dailyGoalTarget });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const awardXPEndpoint = async (req, res) => {
    try {
        const { action, metadata } = req.body;
        const userId = String(req.user._id);
        const result = await awardXP(userId, action, metadata || {});
        if (!result) {
            return res.json({ message: 'No XP awarded (duplicate or invalid action)' });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getLeaderboard = async (req, res) => {
    try {
        const requestedTimeframe = String(req.query.timeframe || 'today');
        const timeframe = ['today', 'lifetime'].includes(requestedTimeframe) ? requestedTimeframe : 'today';
        let sortField = 'dailyXP';
        let query = {};
        let limit = 80;

        if (timeframe === 'today') {
            sortField = 'dailyXP';
            limit = 10;
            const todayStr = new Date().toISOString().split('T')[0];
            query.dayStart = todayStr;
        } else if (timeframe === 'lifetime') {
            sortField = 'xp';
        }

        const userId = String(req.user._id);

        const topProgress = await UserProgress.find(query)
            .sort({ [sortField]: -1 })
            .limit(limit)
            .lean();

        const rawIds = topProgress.map((p) => p.userId).filter(Boolean);
        const objIds = rawIds
            .map((id) => {
                try {
                    return new mongoose.Types.ObjectId(id);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const users = await User.find({
            $or: [
                { _id: { $in: objIds } },
                { firebaseUid: { $in: rawIds } }
            ]
        })
            .select('name settings role avatar profile firebaseUid')
            .lean();

        const userMap = {};
        users.forEach((u) => {
            userMap[String(u._id)] = u;
            if (u.firebaseUid) userMap[String(u.firebaseUid)] = u;
        });

        const rows = [];
        for (const p of topProgress) {
            const u = userMap[p.userId];
            if (!u) continue;
            if (u.role === 'admin') continue;

            const isCurrentUser = p.userId === userId || (req.user.firebaseUid && p.userId === req.user.firebaseUid);

            rows.push({
                userId: p.userId,
                isMe: isCurrentUser,
                name: u.name || 'Anonymous',
                avatar: u.avatar || u.settings?.avatar || u.profile?.avatar || null,
                displayXP: p[sortField] || 0,
                dailyXP: p.dailyXP || 0,
                weeklyXP: p.weeklyXP || 0,
                totalXP: p.xp || 0,
                level: p.level,
                levelName: p.levelName,
                badges: (p.badges || []).slice(-3),
                streak: p.streak,
            });
        }

        rows.sort((a, b) => b.displayXP - a.displayXP);

        const leaderboard = rows.map((row, i) => ({
            ...row,
            rank: i + 1,
        }));

        const myEntry = leaderboard.find((l) => l.userId === userId);

        const myProgress = await UserProgress.findOne({ userId });
        const todayStr = new Date().toISOString().split('T')[0];
        const progressIsCurrent = timeframe === 'today'
            ? myProgress?.dayStart === todayStr
            : true;
        const myDisplayXP = progressIsCurrent ? (myProgress?.[sortField] || 0) : 0;

        let myRank = myEntry?.rank || 0;
        if (myProgress && myRank === 0) {
            const higherProgress = await UserProgress.find({ ...query, [sortField]: { $gt: myDisplayXP } })
                .select('userId')
                .lean();
            const higherIds = [...new Set(higherProgress.map((p) => p.userId).filter(Boolean))]
                .map((id) => {
                    try { return new mongoose.Types.ObjectId(id); } catch { return null; }
                })
                .filter(Boolean);
            const higherStudents = higherIds.length
                ? await User.countDocuments({ _id: { $in: higherIds }, role: { $ne: 'admin' } })
                : 0;
            myRank = higherStudents + 1;
        }

        if (myRank > 0 && myRank <= 10) {
            await tryGrantTop10Badge(userId, myRank);
        }

        res.json({
            leaderboard,
            myRank,
            myDisplayXP,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
