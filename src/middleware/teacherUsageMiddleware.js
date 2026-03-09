import User from '../models/User.js';
import { TEACHER_PLANS } from '../config/plans.js';

export const checkTeacherUsage = (feature) => async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id);

        const isPaid = user.teacherPlan !== 'free' &&
            user.teacherPlanEnd &&
            new Date(user.teacherPlanEnd) > new Date();

        if (isPaid) {
            req.teacherUser = user;
            return next();
        }

        const used = user.teacherUsage?.[feature] || 0;
        const limit = TEACHER_PLANS.free.usagePerFeature;

        if (used >= limit) {
            return res.status(403).json({
                error: 'Free limit reached',
                showUpgrade: true,
                feature: 'teacher',
                used,
                limit
            });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $inc: { [`teacherUsage.${feature}`]: 1 }
        });

        req.teacherUser = user;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
