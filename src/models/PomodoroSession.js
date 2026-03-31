import mongoose from 'mongoose';

const pomodoroSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    startTime: Date,
    endTime: Date,
    duration: { type: Number, required: true },
    type: { type: String, enum: ['work', 'shortBreak', 'longBreak'], required: true },
    completed: { type: Boolean, default: false },
    taskName: { type: String, default: '' },
}, { timestamps: true });

pomodoroSessionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('PomodoroSession', pomodoroSessionSchema);
