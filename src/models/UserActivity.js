import mongoose from 'mongoose';

const userActivitySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        type: {
            type: String,
            required: true,
            trim: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        subtitle: {
            type: String,
            default: '',
            trim: true
        },
        color: {
            type: String,
            default: 'blue',
            trim: true
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

userActivitySchema.index({ userId: 1, createdAt: -1 });

const UserActivity = mongoose.model('UserActivity', userActivitySchema);
export default UserActivity;
