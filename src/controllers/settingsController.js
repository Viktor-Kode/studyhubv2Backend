import User from '../models/User.js';

export const getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('settings name email schoolName phone');
        res.status(200).json({ success: true, settings: user.settings, profile: user });
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
            if (profile.schoolName) updateData.schoolName = profile.schoolName;
            if (profile.phone) updateData.phone = profile.phone;
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        ).select('settings name email schoolName phone');

        res.status(200).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
