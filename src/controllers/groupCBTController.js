import crypto from 'crypto';
import GroupCBT from '../models/GroupCBT.js';
import User from '../models/User.js';
import { fetchCbtQuestionPack } from './cbtController.js';
import { awardXP } from './progressController.js';

function genInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/** Align with `getExamTypesToTry` in cbtController / ALOC */
function canonicalExamType(raw) {
    const x = String(raw || '').trim().toLowerCase();
    if (x === 'jamb' || x === 'utme') return 'utme';
    if (x === 'waec' || x === 'wassce') return 'wassce';
    if (x === 'neco') return 'neco';
    if (x === 'bece') return 'bece';
    if (x === 'post_utme' || x === 'post-utme' || x === 'postutme') return 'post-utme';
    return x || 'utme';
}

async function uniqueInviteCode() {
    for (let i = 0; i < 8; i++) {
        const code = genInviteCode();
        const exists = await GroupCBT.findOne({ inviteCode: code }).select('_id').lean();
        if (!exists) return code;
    }
    return `${genInviteCode()}${Date.now() % 1000}`;
}

const stripQuestion = (q) => ({
    index: q.index,
    question: q.question,
    options: q.options,
    image: q.image || null,
});

export const createGroup = async (req, res) => {
    try {
        const { name, subject, examType, year = 'any', questionCount = 10, maxMembers = 10 } = req.body;
        if (!name || !subject || !examType) {
            return res.status(400).json({ success: false, message: 'name, subject, examType required' });
        }
        const inviteCode = await uniqueInviteCode();
        const session = await GroupCBT.create({
            name: String(name).trim(),
            createdBy: String(req.user._id),
            subject: String(subject).trim(),
            examType: canonicalExamType(examType),
            year: year ? String(year) : 'any',
            questionCount: Math.min(40, Math.max(1, parseInt(questionCount, 10) || 10)),
            maxMembers: Math.min(50, Math.max(2, parseInt(maxMembers, 10) || 10)),
            inviteCode,
            members: [{
                userId: String(req.user._id),
                name: req.user.name || 'You',
                joinedAt: new Date(),
            }],
        });
        res.status(201).json({ success: true, session: await shapeSession(session, req) });
    } catch (e) {
        console.error('[groupCBT create]', e);
        res.status(500).json({ success: false, message: e.message });
    }
};

async function shapeSession(doc, req) {
    const s = doc.toObject ? doc.toObject() : doc;
    const me = String(req.user._id);
    const member = (s.members || []).find((m) => m.userId === me);
    const out = {
        ...s,
        isCreator: s.createdBy === me,
        myMember: member || null,
    };
    if (s.status === 'in_progress' && member) {
        out.questionsForClient = (s.questionsSnapshot || []).map(stripQuestion);
    }
    if (s.status === 'completed') {
        out.leaderboard = [...(s.members || [])]
            .filter((m) => m.completed)
            .sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0))
            .map((m, i) => ({
                rank: i + 1,
                userId: m.userId,
                name: m.name,
                accuracy: m.accuracy,
                score: m.score,
                finishedAt: m.finishedAt,
            }));
    }
    delete out.questionsSnapshot;
    return out;
}

export const joinGroup = async (req, res) => {
    try {
        const { inviteCode, groupId } = req.body;
        const filter = inviteCode
            ? { inviteCode: String(inviteCode).trim().toUpperCase() }
            : groupId
                ? { _id: groupId }
                : null;
        if (!filter) return res.status(400).json({ success: false, message: 'inviteCode or groupId required' });
        const session = await GroupCBT.findOne(filter);
        if (!session) return res.status(404).json({ success: false, message: 'Group not found' });
        if (session.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Group is not open for joining' });
        }
        const me = String(req.user._id);
        if ((session.members || []).some((m) => m.userId === me)) {
            return res.json({ success: true, session: await shapeSession(session, req) });
        }
        if ((session.members || []).length >= session.maxMembers) {
            return res.status(400).json({ success: false, message: 'Group is full' });
        }
        const u = await User.findById(req.user._id).select('name').lean();
        session.members.push({
            userId: me,
            name: u?.name || 'Student',
            joinedAt: new Date(),
        });
        await session.save();
        res.json({ success: true, session: await shapeSession(session, req) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const leaveGroup = async (req, res) => {
    try {
        const session = await GroupCBT.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: 'Not found' });
        if (session.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Cannot leave after session started' });
        }
        const me = String(req.user._id);
        if (session.createdBy === me) {
            return res.status(400).json({ success: false, message: 'Creator should delete group instead (not implemented)' });
        }
        session.members = (session.members || []).filter((m) => m.userId !== me);
        await session.save();
        res.json({ success: true, message: 'Left group' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const startGroupSession = async (req, res) => {
    try {
        const session = await GroupCBT.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: 'Not found' });
        if (session.createdBy !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'Only creator can start' });
        }
        if (session.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Already started' });
        }
        if ((session.members || []).length < 1) {
            return res.status(400).json({ success: false, message: 'Need at least one member' });
        }
        const pack = await fetchCbtQuestionPack({
            subject: session.subject,
            type: session.examType,
            year: session.year,
            amount: session.questionCount,
        });
        if (!pack.ok) {
            return res.status(pack.httpStatus || 502).json({
                success: false,
                message: pack.body?.message || pack.body?.error || 'Could not load questions',
            });
        }
        const data = pack.finalData.data || [];
        session.questionsSnapshot = data.map((q, idx) => {
            const opts = q.option ? Object.values(q.option).filter((v) => v != null) : [];
            return {
                index: idx,
                question: q.question,
                options: opts,
                correctAnswer: q.answer,
                image: q.image || null,
            };
        });
        session.status = 'in_progress';
        session.startedAt = new Date();
        await session.save();
        res.json({ success: true, session: await shapeSession(session, req) });
    } catch (e) {
        console.error('[groupCBT start]', e);
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getGroupStatus = async (req, res) => {
    try {
        const session = await GroupCBT.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: 'Not found' });
        const me = String(req.user._id);
        const isMember = (session.members || []).some((m) => m.userId === me);
        if (!isMember) return res.status(403).json({ success: false, message: 'Not a member' });
        res.json({ success: true, session: await shapeSession(session, req) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

function scoreAnswers(snapshot, answers) {
    const byIndex = new Map(snapshot.map((q) => [q.index, q]));
    const answerByIndex = new Map((answers || []).map((a) => [a.questionIndex, a]));
    let correct = 0;
    const total = snapshot.length;
    const detail = [];
    for (const q of snapshot) {
        const a = answerByIndex.get(q.index);
        const sel = String(a?.selectedAnswer || '').trim().toLowerCase();
        const truth = String(q.correctAnswer || '').trim().toLowerCase();
        const ok = sel.length > 0 && sel === truth;
        if (ok) correct++;
        detail.push({
            questionIndex: q.index,
            selectedAnswer: a?.selectedAnswer ?? '',
            isCorrect: ok,
        });
    }
    const accuracy = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
    return { correct, total, accuracy, detail };
}

async function maybeFinalizeSession(session) {
    if (session.status !== 'in_progress') return;
    const members = session.members || [];
    if (!members.length) return;
    const allDone = members.every((m) => m.completed);
    if (!allDone) return;
    const done = members.filter((m) => m.completed);
    done.sort((a, b) => {
        const d = (b.accuracy || 0) - (a.accuracy || 0);
        if (d !== 0) return d;
        return new Date(a.finishedAt || 0) - new Date(b.finishedAt || 0);
    });
    for (let i = 0; i < Math.min(3, done.length); i++) {
        const m = members.find((x) => x.userId === done[i].userId);
        if (m && !m.top3BonusAwarded) {
            m.top3BonusAwarded = true;
            await awardXP(m.userId, 'group_cbt_top3');
        }
    }
    session.status = 'completed';
    session.endedAt = new Date();
    session.markModified('members');
    await session.save();
}

export const submitGroupCBT = async (req, res) => {
    try {
        const { answers, timeTaken } = req.body;
        const session = await GroupCBT.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: 'Not found' });
        if (session.status !== 'in_progress') {
            return res.status(400).json({ success: false, message: 'Session not active' });
        }
        const me = String(req.user._id);
        const member = (session.members || []).find((m) => m.userId === me);
        if (!member) return res.status(403).json({ success: false, message: 'Not a member' });
        if (member.completed) {
            return res.json({ success: true, session: await shapeSession(session, req), alreadyCompleted: true });
        }
        const snap = session.questionsSnapshot || [];
        const { correct, total, accuracy, detail } = scoreAnswers(snap, answers);
        member.score = correct;
        member.accuracy = accuracy;
        member.answers = detail;
        member.completed = true;
        member.finishedAt = new Date();
        member.timeTaken = timeTaken != null ? Number(timeTaken) : null;

        if (!member.xpAwarded) {
            member.xpAwarded = true;
            await awardXP(me, 'cbt_complete');
            if (accuracy >= 80) await awardXP(me, 'cbt_high_score');
        }

        await session.save();
        await maybeFinalizeSession(session);
        const fresh = await GroupCBT.findById(session._id);
        res.json({ success: true, session: await shapeSession(fresh, req), score: { correct, total, accuracy } });
    } catch (e) {
        console.error('[groupCBT submit]', e);
        res.status(500).json({ success: false, message: e.message });
    }
};

export const listMyGroupCBTs = async (req, res) => {
    try {
        const me = String(req.user._id);
        const sessions = await GroupCBT.find({
            $or: [{ createdBy: me }, { 'members.userId': me }],
        })
            .sort({ updatedAt: -1 })
            .limit(50)
            .lean();
        const shaped = await Promise.all(sessions.map((s) => shapeSession(s, req)));
        res.json({ success: true, sessions: shaped });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
