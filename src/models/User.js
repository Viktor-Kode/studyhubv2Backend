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
    institution: String,

    // Phone fields (keep legacy `phone` for backward compatibility)
    phone: String,
    phoneNumber: { type: String, default: null },

    passwordResetToken: String,
    passwordResetExpires: Date,

    settings: {
        type: Object,
        default: {}
    },

    preferences: {
        hideTourButton: { type: Boolean, default: true },
        hideChatbot: { type: Boolean, default: true },
    },

    // ─── Subscription & Usage (New System) ───────────────────────────────
    subscriptionStatus: {
        type: String,
        enum: ['free', 'active', 'expired'],
        default: 'free'
    },
    subscriptionPlan: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
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
    flashcardUsageLimit: { type: Number, default: 3 },

    // ─── Teacher Plan & Usage ───────────────────────────────────────────────
    teacherPlan: { type: String, enum: ['free', 'weekly', 'monthly'], default: 'free' },
    teacherPlanEnd: { type: Date, default: null },
    teacherUsage: {
        question_generator: { type: Number, default: 0 },
        lesson_note: { type: Number, default: 0 },
        result_compiler: { type: Number, default: 0 },
        report_card: { type: Number, default: 0 },
        scheme_of_work: { type: Number, default: 0 },
        marking_scheme: { type: Number, default: 0 },
        differentiated: { type: Number, default: 0 },
        comprehension: { type: Number, default: 0 },
        class_record: { type: Number, default: 0 }
    },

    lastSeen: { type: Date, default: null },

    emailUnsubscribed: { type: Boolean, default: false },

    // ─── Community Gamification Points ────────────────────────────────
    communityPoints: { type: Number, default: 0 },
    cbtPoints: { type: Number, default: 0 }, // increment when CBT completed
    totalPoints: { type: Number, default: 0 }, // communityPoints + cbtPoints
    postsCount: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },

    communityBookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost' }],
    communityBadges: [{ type: String }], // e.g. first_post, streak_30
    bestAnswersCount: { type: Number, default: 0 },

    banned: { type: Boolean, default: false },

    fcmToken: { type: String, default: null },
    notificationsEnabled: { type: Boolean, default: false },
    webPushSubscription: { type: Object, default: null },
    isPWA: { type: Boolean, default: false },
    following: [{ type: String }],

    // Referral System
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    aiCredits: { type: Number, default: 5 },
    referrals: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rewarded: { type: Boolean, default: false },
        date: { type: Date, default: Date.now }
    }]

}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual field for backward compatibility with frontend 'plan' expectations
userSchema.virtual('plan').get(function () {
    let isActive = false;
    let planType = 'free';

    if (this.role === 'admin') {
        isActive = true;
        planType = 'premium';
    } else if (this.role === 'teacher') {
        isActive = this.teacherPlan !== 'free' && 
                   this.teacherPlanEnd && 
                   new Date(this.teacherPlanEnd) > new Date();
        planType = isActive ? (this.teacherPlan || 'monthly') : 'free';
    } else {
        isActive = this.subscriptionStatus === 'active' && 
                   this.subscriptionEnd && 
                   new Date(this.subscriptionEnd) > new Date();
        planType = isActive ? (this.subscriptionPlan || 'monthly') : 'free';
    }
    
    return {
        type: planType,
        testsAllowed: planType === 'free' ? 3 : 99999,
        testsUsed: 0,
        aiExplanationsAllowed: this.aiUsageLimit || 5,
        aiExplanationsUsed: this.aiUsageCount || 0,
        subjectsAllowed: planType === 'free' ? ['english'] : [],
        allSubjects: planType !== 'free',
        expiresAt: (this.role === 'teacher' ? this.teacherPlanEnd : this.subscriptionEnd) 
            ? (this.role === 'teacher' ? this.teacherPlanEnd : this.subscriptionEnd).toISOString() 
            : null
    };
});

// Generate referral code on signup
userSchema.pre('save', async function () {
    if (this.isNew && !this.referralCode) {
        this.referralCode = Buffer.from(this._id.toString())
            .toString('base64')
            .slice(0, 8)
            .toUpperCase();
    }
});

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
