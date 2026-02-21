import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
    try {
        // 1) Getting token and check of it's there
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

        // 2) Verification token
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

        // 3) Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            const error = new Error('The user belonging to this token does no longer exist.');
            error.statusCode = 401;
            throw error;
        }

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;
        next();
    } catch (err) {
        console.log('Auth Failure Detail:', err.message);
        if (err.name === 'JsonWebTokenError') {
            err.message = 'Invalid token. Please log in again!';
            err.statusCode = 401;
        }
        if (err.name === 'TokenExpiredError') {
            err.message = 'Your token has expired! Please log in again.';
            err.statusCode = 401;
        }
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
