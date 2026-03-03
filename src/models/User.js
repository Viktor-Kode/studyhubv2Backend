import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
    // Core identity
    name: { type: String, required: true },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        lowercase: true,
        trim: true
    },

    // Local password (for legacy / non-Firebase flows)
    password: {
        type: String,
        required: function () {
            return !this.googleId && !this.firebaseUid;
        },
        minlength: 8,
        select: false
    },

    // Optional separate hash field for future migrations
    passwordHash: { type: String },

    role: {
        type: String,
        enum: ['student', 'teacher', 'admin'],
        default: 'student'
    },

    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    firebaseUid: {
        type: String,
        unique: true,
        sparse: true
    },

    schoolName: String,

    // Phone fields (keep legacy `phone` for backward compatibility)
    phone: String,
    phoneNumber: { type: String, default: null },

    passwordResetToken: String,
    passwordResetExpires: Date,

    settings: {
        type: Object,
        default: {}
    },

    // ─── Subscription & Usage (New System) ───────────────────────────────
    subscriptionStatus: {
        type: String,
        enum: ['free', 'active', 'expired'],
        default: 'free'
    },
    subscriptionPlan: {
        type: String,
        enum: ['weekly', 'monthly'],
        default: null
    },
    subscriptionStart: { type: Date, default: null },
    subscriptionEnd: { type: Date, default: null },

    // AI usage (server‑side enforced)
    aiUsageCount: { type: Number, default: 0 },
    aiUsageLimit: { type: Number, default: 5 },
    aiLastReset: { type: Date, default: Date.now },

    // Flashcard generation usage
    flashcardUsageCount: { type: Number, default: 0 },
    flashcardUsageLimit: { type: Number, default: 3 }

}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// Instance method to check password
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
    return await bcrypt.compare(candidatePassword, userPassword);
};

// Instance method to create password reset token
userSchema.methods.createPasswordResetToken = function () {
    const resetToken = crypto.randomBytes(32).toString('hex');

    this.passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

    this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    return resetToken;
};

const User = mongoose.model('User', userSchema);
export default User;
