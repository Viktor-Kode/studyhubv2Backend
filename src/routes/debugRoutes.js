import express from 'express';

const router = express.Router();

/**
 * PRODUCTION DEBUG ROUTE
 * Checks for existence of critical environment variables.
 * DO NOT expose actual values.
 */
router.get('/env', (req, res) => {
    const envStatus = {
        ALOC_ACCESS_TOKEN: {
            exists: !!process.env.ALOC_ACCESS_TOKEN,
            length: process.env.ALOC_ACCESS_TOKEN?.length || 0,
        },
        TWILIO_ACCOUNT_SID: {
            exists: !!process.env.TWILIO_ACCOUNT_SID,
            length: process.env.TWILIO_ACCOUNT_SID?.length || 0,
        },
        TWILIO_AUTH_TOKEN: {
            exists: !!process.env.TWILIO_AUTH_TOKEN,
            length: process.env.TWILIO_AUTH_TOKEN?.length || 0,
        },
        MONGODB_URI: {
            exists: !!process.env.MONGODB_URI,
        },
        MONGO_URI: {
            exists: !!process.env.MONGO_URI,
        },
        NODE_ENV: process.env.NODE_ENV,
        PLATFORM: process.env.RENDER ? 'Render' : 'Local/Other',
    };

    res.json({
        service: 'Backend (Express)',
        timestamp: new Date().toISOString(),
        envStatus,
        message: 'Ensure either MONGODB_URI or MONGO_URI is set in Render settings.'
    });
});

export default router;

