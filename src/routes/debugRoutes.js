import express from 'express';
import { getEnv } from '../config/env.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * PRODUCTION DEBUG ROUTE
 * Checks for existence of critical environment variables.
 * DO NOT expose actual values.
 */
router.get('/env', (req, res) => {
    const envStatus = {
        ALOC_ACCESS_TOKEN: {
            exists: !!getEnv('ALOC_ACCESS_TOKEN'),
            length: getEnv('ALOC_ACCESS_TOKEN')?.length || 0,
        },
        YCLOUD_API_KEY: {
            exists: !!getEnv('YCLOUD_API_KEY'),
            length: getEnv('YCLOUD_API_KEY')?.length || 0,
        },
        YCLOUD_WHATSAPP_NUMBER: {
            exists: !!getEnv('YCLOUD_WHATSAPP_NUMBER'),
            length: getEnv('YCLOUD_WHATSAPP_NUMBER')?.length || 0,
        },
        MONGODB_URI: {
            exists: !!getEnv('MONGODB_URI'),
        },
        MONGO_URI: {
            exists: !!getEnv('MONGO_URI'),
        },
        NODE_ENV: getEnv('NODE_ENV'),
        PLATFORM: getEnv('RENDER') ? 'Render' : 'Local/Other',
    };


    res.json({
        service: 'Backend (Express)',
        timestamp: new Date().toISOString(),
        envStatus,
        message: 'Ensure either MONGODB_URI or MONGO_URI is set in Render settings.'
    });
});

// GET /api/debug/user-subscription
router.get('/user-subscription', protect, async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('email subscriptionStatus subscriptionPlan subscriptionEnd aiUsageLimit aiUsageCount flashcardUsageLimit flashcardUsageCount');

    const transaction = await Transaction.findOne({ userId: req.user.id })
        .sort({ createdAt: -1 });

    res.json({
        user,
        latestTransaction: transaction,
        now: new Date(),
        isExpired: user.subscriptionEnd
            ? new Date(user.subscriptionEnd) < new Date()
            : true
    });
});


export default router;

