import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import sendEmail from '../utils/email.js';
import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';

/**
 * Signs a JWT token
 */
const signToken = (id) => {
    return jwt.sign({ id }, getEnv('JWT_SECRET'), {
        expiresIn: getEnv('JWT_EXPIRES_IN', '90d')
    });
};


/**
 * Normalizes and sends the token response
 */
/**
 * Normalizes and sends the token response
 */
const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);

    const cookieOptions = {
        expires: new Date(
            Date.now() + getEnv('JWT_COOKIE_EXPIRES_IN', 90) * 24 * 60 * 60 * 1000
        ),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict'
    };

    res.cookie('jwt', token, cookieOptions);

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        data: {
            user
        }
    });
};

/**
 * Sign up a new user (Email/Password ONLY)
 */
export const signup = async (req, res, next) => {
    try {
        const { email, password, role, name, schoolName, phone } = req.body;

        const newUser = await User.create({
            email,
            password,
            role: role || 'student',
            name,
            schoolName,
            phone,
            phoneNumber: phone || null
        });

        createSendToken(newUser, 201, res);
    } catch (err) {
        next(err);
    }
};

/**
 * Login user (Email/Password ONLY)
 */
export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // 1) Check if email and password exist
        if (!email || !password) {
            const error = new Error('Please provide email and password!');
            error.statusCode = 400;
            return next(error);
        }

        // 2) Check if user exists && password is correct
        const user = await User.findOne({ email }).select('+password');

        if (!user || !(await user.correctPassword(password, user.password))) {
            const error = new Error('Incorrect email or password');
            error.statusCode = 401;
            return next(error);
        }

        // 3) If everything ok, send token to client
        createSendToken(user, 200, res);
    } catch (err) {
        next(err);
    }
};

/**
 * Get current user details (fresh from DB, including subscription info)
 */
export const getMe = async (req, res, next) => {
    try {
        let user = await User.findById(req.user.id || req.user._id).select(
            'name email role phoneNumber schoolName preferences firebaseUid ' +
            'subscriptionStatus subscriptionPlan subscriptionEnd ' +
            'aiUsageCount aiUsageLimit ' +
            'flashcardUsageCount flashcardUsageLimit ' +
            'notificationsEnabled'
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user = await expireStaleActiveSubscription(user);

        const daysLeft = user.subscriptionEnd
            ? Math.max(0, Math.ceil(
                (new Date(user.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24)
            ))
            : 0;

        const uo = user.toObject();
        res.status(200).json({
            status: 'success',
            data: {
                user: {
                    ...uo,
                    uid: uo.firebaseUid || null,
                    preferences: uo.preferences || { hideTourButton: true, hideChatbot: true },
                    daysLeft,
                    isActive: user.subscriptionStatus === 'active' && daysLeft > 0
                }
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Forgot password - send reset link to email
 */
export const forgotPassword = async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) {
            const error = new Error('There is no user with that email address.');
            error.statusCode = 404;
            return next(error);
        }

        const resetToken = user.createPasswordResetToken();
        await user.save({ validateBeforeSave: false });

        const frontendURL = getEnv('FRONTEND_URL', 'http://localhost:3000');
        const resetURL = `${frontendURL}/reset-password?token=${resetToken}`;


        const message = `Forgot your password? Reset it here: ${resetURL}\nIf you didn't forget your password, please ignore this email!`;

        try {
            await sendEmail({
                email: user.email,
                subject: 'Your password reset token (valid for 10 min)',
                message
            });

            res.status(200).json({
                status: 'success',
                message: 'Token sent to email!'
            });
        } catch (err) {
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save({ validateBeforeSave: false });

            const error = new Error('There was an error sending the email. Try again later!');
            error.statusCode = 500;
            return next(error);
        }
    } catch (err) {
        next(err);
    }
};

/**
 * Reset password using token
 */
export const resetPassword = async (req, res, next) => {
    try {
        const hashedToken = crypto
            .createHash('sha256')
            .update(req.params.token)
            .digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() }
        });

        if (!user) {
            const error = new Error('Token is invalid or has expired');
            error.statusCode = 400;
            return next(error);
        }

        user.password = req.body.newPassword || req.body.password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        createSendToken(user, 200, res);
    } catch (err) {
        next(err);
    }
};

/**
 * Update password (authenticated user)
 */
export const updatePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            const error = new Error('Please provide current and new password');
            error.statusCode = 400;
            return next(error);
        }

        if (newPassword.length < 6) {
            const error = new Error('New password must be at least 6 characters');
            error.statusCode = 400;
            return next(error);
        }

        // Get user with password
        const user = await User.findById(req.user._id).select('+password');

        if (!user || !(await user.correctPassword(currentPassword, user.password))) {
            const error = new Error('Current password is incorrect');
            error.statusCode = 401;
            return next(error);
        }

        user.password = newPassword;
        await user.save();

        createSendToken(user, 200, res);
    } catch (err) {
        next(err);
    }
};
/**
 * Update current user profile (name, role, etc.)
 */
export const updateMe = async (req, res, next) => {
    try {
        const { name, role, schoolName, phone } = req.body;
        const updateData = {};

        if (name) updateData.name = name;
        if (role) updateData.role = role;
        if (schoolName) updateData.schoolName = schoolName;
        if (phone) {
            updateData.phone = phone;
            updateData.phoneNumber = phone;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(200).json({
                status: 'success',
                data: { user: req.user }
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        );

        res.status(200).json({
            status: 'success',
            data: {
                user: updatedUser
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Update help widget visibility preferences (tour button, help chatbot).
 * PATCH /api/users/preferences  body: { hideTourButton?: boolean, hideChatbot?: boolean }
 */
export const updateUserPreferences = async (req, res, next) => {
    try {
        const { hideTourButton, hideChatbot } = req.body || {};
        const $set = {};

        if (typeof hideTourButton === 'boolean') {
            $set['preferences.hideTourButton'] = hideTourButton;
        }
        if (typeof hideChatbot === 'boolean') {
            $set['preferences.hideChatbot'] = hideChatbot;
        }

        if (Object.keys($set).length === 0) {
            return res.status(400).json({
                status: 'fail',
                message: 'Provide hideTourButton and/or hideChatbot as booleans',
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            { $set },
            { new: true, runValidators: true },
        ).select('preferences');

        res.status(200).json({
            status: 'success',
            data: {
                preferences: updatedUser?.preferences || {
                    hideTourButton: true,
                    hideChatbot: true,
                },
            },
        });
    } catch (err) {
        next(err);
    }
};
