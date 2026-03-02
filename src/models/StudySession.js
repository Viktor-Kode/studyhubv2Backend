import mongoose from 'mongoose';

const studySessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['study', 'break'], default: 'study' },
    duration: { type: Number, required: true }, // Usually in minutes
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date, default: Date.now },
    notes: { type: String },
    goalId: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: true });

const StudySession = mongoose.model('StudySession', studySessionSchema);
export default StudySession;
