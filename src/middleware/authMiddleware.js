import { adminAuth } from '../config/firebase-admin.js';
import User from '../models/User.js';
import UserDailyActivity from '../models/UserDailyActivity.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';

const utcDayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export const protect = async (req, res, next) => {
    try {
        // 1) Getting token and check if it's there
        let token;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer')) {
            token = authHeader.split(' ')[1];
        }

        if (!token) {
            console.warn(`[AUTH] 401 - No token provided for ${req.originalUrl}`);
            return res.status(401).json({
                status: 'fail',
                message: 'You are not logged in! Please log in to get access.'
            });
        }

        // 2) Verification of Firebase ID token
        let decodedToken;
        try {
            decodedToken = await adminAuth.verifyIdToken(token);
            console.log(`[AUTH] Token verified for UID: ${decodedToken.uid}`);
        } catch (verifyErr) {
            console.error(`[AUTH] 401 - Token verification failed: ${verifyErr.message}`);
            return res.status(401).json({
                status: 'fail',
                message: 'Your token is invalid or expired. Please log in again.',
                error: verifyErr.code // e.g., 'auth/id-token-expired'
            });
        }

        // 3) Check if user still exists in MongoDB
        let currentUser = await User.findOne({ firebaseUid: decodedToken.uid });

        if (!currentUser && decodedToken.email) {
            currentUser = await User.findOne({ email: decodedToken.email.toLowerCase() });

            // If found by email but no firebaseUid, link them now
            if (currentUser) {
                currentUser.firebaseUid = decodedToken.uid;
                await currentUser.save({ validateBeforeSave: false });
                console.log(`[AUTH] Linked email user ${decodedToken.email} to Firebase UID ${decodedToken.uid}`);
            }
        }

        if (!currentUser) {
            // Create user automatically if they exist in Firebase but not in MongoDB
            try {
                currentUser = await User.create({
                    firebaseUid: decodedToken.uid,
                    email: decodedToken.email?.toLowerCase(),
                    name: decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
                    role: 'student' // Default role for auto-created users
                });
                console.log(`[AUTH] Auto-created MongoDB user for UID: ${decodedToken.uid}`);
            } catch (createErr) {
                console.error('[AUTH] Failed to auto-create user in MongoDB:', createErr.message);
                return res.status(500).json({ status: 'error', message: 'Internal auth synchronization error' });
            }
        }

        // Sync Firebase admin claim to MongoDB if present
        if (decodedToken.admin === true && currentUser.role !== 'admin') {
            currentUser.role = 'admin';
            await currentUser.save({ validateBeforeSave: false });
            console.log(`[AUTH] Synced admin claim to MongoDB for ${currentUser.email}`);
        }

        // Downgrade expired "active" subscriptions before any paid feature runs (no cron dependency)
        currentUser = await expireStaleActiveSubscription(currentUser);

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;

        const now = new Date();
        // Update lastSeen silently (fire-and-forget)
        User.findByIdAndUpdate(currentUser._id, { $set: { lastSeen: now } }).catch(() => {});

        const dk = utcDayKey(now);
        UserDailyActivity.findOneAndUpdate(
            { userId: currentUser._id, dayKey: dk },
            {
                $set: { lastAt: now },
                $setOnInsert: { firstAt: now, userId: currentUser._id, dayKey: dk }
            },
            { upsert: true }
        ).catch(() => {});

        next();
    } catch (err) {
        console.error('[AUTH] Unexpected error in protect middleware:', err);
        res.status(500).json({ status: 'error', message: 'Something went wrong with authentication' });
    }
};

export const restrictTo = (...roles) => {
    return (req, res, next) => {
        const userRole = req.user?.role;
        if (!roles.includes(userRole)) {
            console.log(`[AUTH] 403 - Access denied for ${req.user?.email}, role=${userRole}, required=${roles.join(',')}`);
            return res.status(403).json({
                status: 'fail',
                message: 'You do not have permission to perform this action'
            });
        }
        next();
    };
};
