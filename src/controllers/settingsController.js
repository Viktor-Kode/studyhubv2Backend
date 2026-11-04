import User from '../models/User.js';

export const getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('settings name email schoolName institution phone notificationsEnabled emailUnsubscribed');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const u = user.toObject();
        const s = u.settings && typeof u.settings === 'object' ? u.settings : {};
        const notificationPrefs = {
            studyReminders: false,
            emailStudyReminders: false,
            weeklyDigest: false,
            reminderTime: '18:00',
            timezone: 'Africa/Lagos',
            quietHours: { start: '22:00', end: '07:00' },
            ...(s.notificationPrefs || {}),
        };
        res.status(200).json({
            success: true,
            settings: user.settings,
            notificationPrefs,
            timezoneDetected: Boolean(s.notificationPrefs?.timezone),
            notificationStatus: {
                pushEnabled: Boolean(user.notificationsEnabled),
                emailUnsubscribed: Boolean(user.emailUnsubscribed),
            },
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
        const { settings, profile, notificationPrefs } = req.body;
        const updateData = {};
        if (settings) updateData.settings = settings;
        if (notificationPrefs && typeof notificationPrefs === 'object') {
            const current = await User.findById(req.user._id).select('settings').lean();
            const currentSettings = current?.settings && typeof current.settings === 'object' ? current.settings : {};
            const existingPrefs = currentSettings.notificationPrefs && typeof currentSettings.notificationPrefs === 'object'
                ? currentSettings.notificationPrefs : {};
            const incoming = {};
            for (const key of ['studyReminders', 'emailStudyReminders', 'weeklyDigest', 'streakReminder', 'cbtResults', 'goalReminder', 'planExpiry']) {
                if (typeof notificationPrefs[key] === 'boolean') incoming[key] = notificationPrefs[key];
            }
            if (typeof notificationPrefs.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(notificationPrefs.reminderTime)) {
                incoming.reminderTime = notificationPrefs.reminderTime;
            }
            if (typeof notificationPrefs.timezone === 'string') {
                try {
                    new Intl.DateTimeFormat('en', { timeZone: notificationPrefs.timezone });
                    incoming.timezone = notificationPrefs.timezone;
                } catch { /* ignore unsupported time zones */ }
            }
            updateData.settings = {
                ...currentSettings,
                ...(updateData.settings || {}),
                notificationPrefs: { ...existingPrefs, ...incoming },
            };
        }
        if (profile) {
            if (profile.name) updateData.name = profile.name;
            if (profile.displayName) updateData.name = profile.displayName;
            if (profile.schoolName !== undefined && profile.schoolName !== null) {
                updateData.schoolName = String(profile.schoolName).trim() || null;
            }
            if (profile.institution !== undefined && profile.institution !== null) {
                updateData.institution = String(profile.institution).trim() || null;
            }
            if (profile.phone !== undefined) {
                const phoneVal = profile.phone ? String(profile.phone).trim() : null;
                updateData.phone = phoneVal;
                updateData.phoneNumber = phoneVal;
            }
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
        ).select('settings name email schoolName institution phone');

        res.status(200).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
