import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    subject: { type: String },
    targetMinutes: { type: Number, required: true },
    minutesStudied: { type: Number, default: 0 },
    deadline: { type: Date },
    status: { type: String, enum: ['active', 'completed', 'failed'], default: 'active' },
    createdAt: { type: Date, default: Date.now },
    period: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
    color: { type: String }
});

const Goal = mongoose.model('Goal', goalSchema);
export default Goal;
