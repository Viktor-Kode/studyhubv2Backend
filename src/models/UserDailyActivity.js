import mongoose from 'mongoose';

/** One row per user per UTC calendar day — first/last authenticated API activity (proxy for app usage). */
const userDailyActivitySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        dayKey: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/
        },
        firstAt: { type: Date, required: true },
        lastAt: { type: Date, required: true }
    },
    { timestamps: false }
);

userDailyActivitySchema.index({ userId: 1, dayKey: 1 }, { unique: true });

const UserDailyActivity = mongoose.model('UserDailyActivity', userDailyActivitySchema);
export default UserDailyActivity;
