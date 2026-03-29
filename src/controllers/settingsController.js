import User from '../models/User.js';

export const getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('settings name email schoolName classLevel phone notificationsEnabled');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const u = user.toObject();
        const s = u.settings && typeof u.settings === 'object' ? u.settings : {};
        res.status(200).json({
            success: true,
            settings: user.settings,
            profile: {
                ...u,
                examTarget: s.examTarget,
                subjects: s.subjects,
                targetYear: s.targetYear,
                avatar: s.avatar,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateSettings = async (req, res) => {
    try {
        const { settings, profile } = req.body;
        const updateData = {};
        if (settings) updateData.settings = settings;
        if (profile) {
            if (profile.name) updateData.name = profile.name;
            if (profile.schoolName !== undefined && profile.schoolName !== null) {
                updateData.schoolName = String(profile.schoolName).trim() || null;
            }
            if (profile.classLevel !== undefined && profile.classLevel !== null) {
                updateData.classLevel = String(profile.classLevel).trim() || null;
            }
            if (profile.phone !== undefined) updateData.phone = profile.phone ? String(profile.phone).trim() : null;
        }

        if (profile && (profile.examTarget != null || profile.subjects != null || profile.targetYear != null || profile.avatar != null)) {
            const cur = await User.findById(req.user._id).select('settings');
            const fromDb = cur?.settings && typeof cur.settings === 'object' ? cur.settings : {};
            const fromReq = updateData.settings && typeof updateData.settings === 'object' ? updateData.settings : {};
            const nextSettings = { ...fromDb, ...fromReq };
            if (profile.examTarget != null) nextSettings.examTarget = profile.examTarget;
            if (profile.subjects != null) nextSettings.subjects = profile.subjects;
            if (profile.targetYear != null) nextSettings.targetYear = profile.targetYear;
            if (profile.avatar != null) nextSettings.avatar = profile.avatar;
            updateData.settings = nextSettings;
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        ).select('settings name email schoolName classLevel phone');

        res.status(200).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
