import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import SharedLibraryItem from '../models/SharedLibraryItem.js';
import User from '../models/User.js';
import { awardXP } from './progressController.js';

export const sharedLibraryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
});

const uidStr = (req) => String(req.user._id);

async function attachAuthors(items) {
    const ids = [...new Set(items.map((i) => String(i.userId)))];
    const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    return items.map((i) => {
        const u = map.get(String(i.userId));
        return {
            ...i,
            authorName: u?.name || 'Student',
            authorEmail: u?.email || '',
        };
    });
}

export const submitSharedLibraryItem = async (req, res) => {
    try {
        const { title, description, type, url, textContent, subject, tags } = req.body;
        if (!title || !type) {
            return res.status(400).json({ success: false, message: 'title and type are required' });
        }
        let fileUrl = null;
        if (type === 'file' && req.file?.buffer) {
            const folder = 'studyhelp/shared-library';
            const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const up = await cloudinary.uploader.upload(b64, {
                folder,
                resource_type: 'auto',
                use_filename: true,
                unique_filename: true,
            });
            fileUrl = up.secure_url;
        }
        if (type === 'link' && !url) {
            return res.status(400).json({ success: false, message: 'url required for link type' });
        }
        if (type === 'text' && !textContent) {
            return res.status(400).json({ success: false, message: 'textContent required for text type' });
        }
        const item = await SharedLibraryItem.create({
            userId: req.user._id,
            title,
            description: description || '',
            type,
            url: url || undefined,
            fileUrl: fileUrl || undefined,
            textContent: textContent || undefined,
            subject: subject || '',
            tags: Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
            moderationStatus: 'pending',
        });
        const lean = item.toObject();
        res.status(201).json({ success: true, item: (await attachAuthors([lean]))[0] });
    } catch (e) {
        console.error('[sharedLibrary submit]', e);
        res.status(500).json({ success: false, message: e.message || 'Upload failed' });
    }
};

export const getApprovedSharedLibrary = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const sort = req.query.sort === 'upvotes' ? 'upvotes' : 'recent';
        const { subject, tag, search } = req.query;
        const filter = { moderationStatus: 'approved' };
        if (subject) filter.subject = new RegExp(`^${subject}$`, 'i');
        if (tag) filter.tags = String(tag);
        if (search) {
            const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
        }
        const skip = (page - 1) * limit;
        let query = SharedLibraryItem.find(filter).lean();
        if (sort === 'upvotes') {
            query = query.sort({ createdAt: -1 }); // load then sort by upvote length in JS for simplicity
        } else {
            query = query.sort({ createdAt: -1 });
        }
        const raw = await query.skip(skip).limit(limit * 2).exec();
        let list = raw;
        if (sort === 'upvotes') {
            list = [...raw].sort((a, b) => (b.upvotes?.length || 0) - (a.upvotes?.length || 0)).slice(0, limit);
        } else {
            list = raw.slice(0, limit);
        }
        const total = await SharedLibraryItem.countDocuments(filter);
        const me = uidStr(req);
        const shaped = list.map((i) => ({
            ...i,
            upvoteCount: (i.upvotes || []).length,
            downvoteCount: (i.downvotes || []).length,
            userVote: (i.upvotes || []).includes(me) ? 'up' : (i.downvotes || []).includes(me) ? 'down' : null,
        }));
        res.json({ success: true, items: await attachAuthors(shaped), page, total, hasMore: skip + list.length < total });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const voteSharedLibrary = async (req, res) => {
    try {
        const { direction } = req.body; // 'up' | 'down' | 'clear'
        if (!['up', 'down', 'clear'].includes(direction)) {
            return res.status(400).json({ success: false, message: 'direction must be up, down, or clear' });
        }
        const item = await SharedLibraryItem.findById(req.params.id);
        if (!item || item.moderationStatus !== 'approved') {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }
        const me = uidStr(req);
        const hadUp = (item.upvotes || []).includes(me);
        let up = new Set(item.upvotes || []);
        let down = new Set(item.downvotes || []);
        up.delete(me);
        down.delete(me);
        if (direction === 'up') {
            up.add(me);
            if (!hadUp) await awardXP(me, 'library_upvote');
        } else if (direction === 'down') {
            down.add(me);
        }
        item.upvotes = [...up];
        item.downvotes = [...down];
        await item.save();
        const lean = item.toObject();
        const uv = (lean.upvotes || []).includes(me) ? 'up' : (lean.downvotes || []).includes(me) ? 'down' : null;
        const shaped = {
            ...lean,
            upvoteCount: (lean.upvotes || []).length,
            downvoteCount: (lean.downvotes || []).length,
            userVote: uv,
        };
        res.json({ success: true, item: (await attachAuthors([shaped]))[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const incrementSharedLibraryDownload = async (req, res) => {
    try {
        const item = await SharedLibraryItem.findOne({
            _id: req.params.id,
            moderationStatus: 'approved',
        });
        if (!item) return res.status(404).json({ success: false, message: 'Not found' });
        item.downloads = (item.downloads || 0) + 1;
        await item.save();
        res.json({ success: true, downloads: item.downloads, url: item.url, fileUrl: item.fileUrl });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const mySharedLibrarySubmissions = async (req, res) => {
    try {
        const items = await SharedLibraryItem.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, items });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const adminSetSharedLibraryStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'rejected', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        const item = await SharedLibraryItem.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: 'Not found' });
        const prev = item.moderationStatus;
        item.moderationStatus = status;
        await item.save();
        if (status === 'approved' && prev !== 'approved') {
            await awardXP(String(item.userId), 'library_approved');
        }
        res.json({ success: true, item });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const adminListPendingSharedLibrary = async (req, res) => {
    try {
        const items = await SharedLibraryItem.find({ moderationStatus: 'pending' })
            .sort({ createdAt: 1 })
            .limit(100)
            .lean();
        res.json({ success: true, items: await attachAuthors(items) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
