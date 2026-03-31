import SharedNote from '../models/SharedNote.js';
import User from '../models/User.js';
import { awardXP } from './progressController.js';

const uid = (req) => String(req.user._id);

function noteToJSON(note, currentUserId) {
    const o = note.toObject ? note.toObject() : note;
    const ownerId = String(o.userId);
    return {
        ...o,
        userId: ownerId,
        likeCount: (o.likes || []).length,
        likedByMe: (o.likes || []).includes(currentUserId),
        isOwner: ownerId === currentUserId,
    };
}

export const createSharedNote = async (req, res) => {
    try {
        const { title, content, subject, tags, isPublic } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Title and content are required.' });
        }
        const note = await SharedNote.create({
            userId: req.user._id,
            title,
            content,
            subject: subject || '',
            tags: Array.isArray(tags) ? tags : [],
            isPublic: !!isPublic,
        });
        await awardXP(uid(req), 'create_note');
        if (note.isPublic) {
            note.shareXpAwarded = true;
            await note.save();
            await awardXP(uid(req), 'share_note');
        }
        res.status(201).json({ success: true, note: noteToJSON(note, uid(req)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getMySharedNotes = async (req, res) => {
    try {
        const notes = await SharedNote.find({ userId: req.user._id }).sort({ updatedAt: -1 }).lean();
        res.json({ success: true, notes: notes.map((n) => noteToJSON(n, uid(req))) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getSharedWithMe = async (req, res) => {
    try {
        const me = uid(req);
        const q = {
            userId: { $ne: req.user._id },
            $or: [{ isPublic: true }, { sharedWith: me }],
        };
        const { subject, tag, search } = req.query;
        if (subject) q.subject = new RegExp(`^${subject}$`, 'i');
        if (tag) q.tags = String(tag).trim().toLowerCase();
        if (search) {
            const rx = new RegExp(search, 'i');
            q.$and = q.$and || [];
            q.$and.push({ $or: [{ title: rx }, { content: rx }, { tags: rx }] });
        }
        const notes = await SharedNote.find(q).sort({ updatedAt: -1 }).lean();
        res.json({ success: true, notes: notes.map((n) => noteToJSON(n, me)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getSharedNoteById = async (req, res) => {
    try {
        const me = uid(req);
        const note = await SharedNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        const owner = String(note.userId);
        const canSee = owner === me || note.isPublic || (note.sharedWith || []).includes(me);
        if (!canSee) return res.status(403).json({ success: false, message: 'Not allowed' });
        if (owner !== me) {
            note.viewCount = (note.viewCount || 0) + 1;
            await note.save();
        }
        res.json({ success: true, note: noteToJSON(note, me) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const updateSharedNote = async (req, res) => {
    try {
        const { title, content, subject, tags, isPublic } = req.body;
        const note = await SharedNote.findOne({ _id: req.params.id, userId: req.user._id });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        if (title != null) note.title = title;
        if (content != null) note.content = content;
        if (subject != null) note.subject = subject;
        if (tags != null) note.tags = Array.isArray(tags) ? tags : [];
        if (typeof isPublic === 'boolean') note.isPublic = isPublic;
        await note.save();
        res.json({ success: true, note: noteToJSON(note, uid(req)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const deleteSharedNote = async (req, res) => {
    try {
        const deleted = await SharedNote.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Note not found' });
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const toggleSharedNotePublic = async (req, res) => {
    try {
        const { isPublic } = req.body;
        if (typeof isPublic !== 'boolean') {
            return res.status(400).json({ success: false, message: 'isPublic boolean required' });
        }
        const note = await SharedNote.findOne({ _id: req.params.id, userId: req.user._id });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        const wasPublic = note.isPublic;
        note.isPublic = isPublic;
        if (isPublic && !wasPublic && !note.shareXpAwarded) {
            note.shareXpAwarded = true;
            await note.save();
            await awardXP(uid(req), 'share_note');
        } else {
            await note.save();
        }
        res.json({ success: true, note: noteToJSON(note, uid(req)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const shareSharedNoteWithUser = async (req, res) => {
    try {
        const { email, userId: targetUserId } = req.body;
        let targetId = targetUserId ? String(targetUserId) : null;
        if (!targetId && email) {
            const u = await User.findOne({ email: String(email).toLowerCase().trim() });
            if (!u) return res.status(404).json({ success: false, message: 'User not found' });
            targetId = String(u._id);
        }
        if (!targetId) return res.status(400).json({ success: false, message: 'email or userId required' });
        if (targetId === uid(req)) {
            return res.status(400).json({ success: false, message: 'Cannot share with yourself' });
        }
        const note = await SharedNote.findOne({ _id: req.params.id, userId: req.user._id });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        const set = new Set(note.sharedWith || []);
        set.add(targetId);
        note.sharedWith = [...set];
        await note.save();
        res.json({ success: true, note: noteToJSON(note, uid(req)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const likeSharedNote = async (req, res) => {
    try {
        const me = uid(req);
        const note = await SharedNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        const owner = String(note.userId);
        const canSee = owner === me || note.isPublic || (note.sharedWith || []).includes(me);
        if (!canSee) return res.status(403).json({ success: false, message: 'Not allowed' });
        const likes = new Set(note.likes || []);
        if (likes.has(me)) likes.delete(me);
        else likes.add(me);
        note.likes = [...likes];
        await note.save();
        res.json({ success: true, note: noteToJSON(note, me) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const searchSharedNotes = async (req, res) => {
    try {
        const me = uid(req);
        const { q, subject, tag } = req.query;
        const filter = {
            $or: [
                { userId: req.user._id },
                { isPublic: true },
                { sharedWith: me },
            ],
        };
        const and = [{ ...filter }];
        if (q) {
            const rx = new RegExp(String(q), 'i');
            and.push({ $or: [{ title: rx }, { content: rx }, { tags: rx }] });
        }
        if (subject) and.push({ subject: new RegExp(`^${subject}$`, 'i') });
        if (tag) and.push({ tags: new RegExp(tag, 'i') });
        const notes = await SharedNote.find({ $and: and }).sort({ updatedAt: -1 }).limit(80).lean();
        res.json({ success: true, notes: notes.map((n) => noteToJSON(n, me)) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const searchUsersForShare = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || String(q).trim().length < 2) {
            return res.json({ success: true, users: [] });
        }
        const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const users = await User.find({
            $or: [{ email: rx }, { name: rx }],
            role: 'student',
        })
            .select('name email')
            .limit(15)
            .lean();
        res.json({
            success: true,
            users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
