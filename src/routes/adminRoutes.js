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

// POST /api/admin/migrate-subscriptions
router.post('/migrate-subscriptions', async (req, res) => {
    const { secretKey } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const users = await User.find({
        'plan.type': { $exists: true }
    });

    console.log(`Found ${users.length} users with old schema`);
    let migrated = 0;

    for (const user of users) {
        const oldPlan = user.plan?.type;
        const oldExpiry = user.plan?.expiresAt;

        if (!oldPlan || oldPlan === 'free') continue;

        const planMap = {
            starter: 'weekly',
            growth: 'monthly',
            premium: 'monthly',
            weekly: 'weekly',
            monthly: 'monthly'
        };

        const newPlan = planMap[oldPlan] || 'monthly';
        const planConfig = PLANS[newPlan];

        const now = new Date();
        const end = oldExpiry && new Date(oldExpiry) > now
            ? new Date(oldExpiry)
            : new Date(now.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000);

        await User.findByIdAndUpdate(user._id, {
            $set: {
                subscriptionStatus: 'active',
                subscriptionPlan: newPlan,
                subscriptionStart: user.plan?.createdAt || new Date(),
                subscriptionEnd: end,
                aiUsageCount: user.plan?.aiExplanationsUsed || 0,
                aiUsageLimit: planConfig.aiLimit,
                flashcardUsageCount: 0,
                flashcardUsageLimit: planConfig.flashcardLimit
            }
        });

        migrated++;
    }

    res.json({
        success: true,
        total: users.length,
        migrated,
        message: `✅ Migrated ${migrated} users to new subscription schema`
    });
});

export default router;

