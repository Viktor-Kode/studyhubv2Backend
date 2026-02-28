import mongoose from 'mongoose';

const studySessionSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    durationSeconds: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Goal', default: null }
});

const StudySession = mongoose.model('StudySession', studySessionSchema);
export default StudySession;
