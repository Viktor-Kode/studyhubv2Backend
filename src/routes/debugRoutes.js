import express from 'express';
import { getEnv } from '../config/env.js';

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
        TWILIO_ACCOUNT_SID: {
            exists: !!getEnv('TWILIO_ACCOUNT_SID'),
            length: getEnv('TWILIO_ACCOUNT_SID')?.length || 0,
        },
        TWILIO_AUTH_TOKEN: {
            exists: !!getEnv('TWILIO_AUTH_TOKEN'),
            length: getEnv('TWILIO_AUTH_TOKEN')?.length || 0,
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

/**
 * DEBUG STUDY GUIDES
 * Shows exactly what is in the DB
 */
import StudyGuide from '../models/StudyGuide.js';
router.get('/library', async (req, res) => {
    try {
        const total = await StudyGuide.countDocuments();
        const validated = await StudyGuide.countDocuments({ validated: true });
        const unvalidated = await StudyGuide.countDocuments({ validated: false });
        const sample = await StudyGuide.find().limit(2).lean();

        res.json({
            total,
            validated,
            unvalidated,
            sample,
            message: total === 0
                ? '❌ Database is empty — guides have never been seeded'
                : `✅ ${total} guides in DB but ${unvalidated} are unvalidated`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

