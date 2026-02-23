import { adminAuth } from '../config/firebase-admin.js';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
    try {
        // 1) Getting token and check if it's there
        let token;
        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith('Bearer')
        ) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            console.log('Auth Failure: No token found in headers');
            const error = new Error('You are not logged in! Please log in to get access.');
            error.statusCode = 401;
            throw error;
        }

        // 2) Verification of Firebase ID token
        const decodedToken = await adminAuth.verifyIdToken(token);

        // 3) Check if user still exists in MongoDB
        // Try finding by firebaseUid first, then fallback to email
        let currentUser = await User.findOne({ firebaseUid: decodedToken.uid });

        if (!currentUser && decodedToken.email) {
            currentUser = await User.findOne({ email: decodedToken.email.toLowerCase() });

            // If found by email but no firebaseUid, link them now
            if (currentUser) {
                currentUser.firebaseUid = decodedToken.uid;
                await currentUser.save({ validateBeforeSave: false });
            }
        }

        if (!currentUser) {
            // Create user automatically if they exist in Firebase but not in MongoDB
            try {
                currentUser = await User.create({
                    firebaseUid: decodedToken.uid,
                    email: decodedToken.email?.toLowerCase(),
                    name: decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
                    role: decodedToken.role || 'student'
                });
                console.log(`Created new MongoDB user for Firebase UID: ${decodedToken.uid}`);
            } catch (createErr) {
                console.error('Failed to auto-create user in MongoDB:', createErr);
                throw createErr;
            }
        }

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;
        next();
    } catch (err) {
        console.log('Auth Failure Detail:', err.message);
        err.statusCode = 401;
        next(err);
    }
};

export const restrictTo = (...roles) => {
    return (req, res, next) => {
        // roles ['teacher', 'student']. role='student'
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                status: 'fail',
                message: 'You do not have permission to perform this action'
            });
        }

        next();
    };
};
