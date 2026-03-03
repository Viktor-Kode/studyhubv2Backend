import express from 'express';
import User from '../models/User.js';
import { PLANS } from '../config/plans.js';

const router = express.Router();

// POST /api/admin/fix-subscription
router.post('/fix-subscription', async (req, res) => {
    const { userId, plan, secretKey } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const planConfig = PLANS[plan];
        if (!planConfig) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const now = new Date();
        const newEnd = new Date(now);
        newEnd.setDate(newEnd.getDate() + planConfig.durationDays);

        const updated = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    subscriptionStatus: 'active',
                    subscriptionPlan: plan,
                    subscriptionStart: now,
                    subscriptionEnd: newEnd,
                    aiUsageCount: 0,
                    aiUsageLimit: planConfig.aiLimit,
                    flashcardUsageCount: 0,
                    flashcardUsageLimit: planConfig.flashcardLimit
                }
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            message: `✅ Manually activated ${plan} for user`,
            user: {
                email: updated.email,
                status: updated.subscriptionStatus,
                plan: updated.subscriptionPlan,
                end: updated.subscriptionEnd
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

