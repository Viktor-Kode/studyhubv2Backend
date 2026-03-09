import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: String,
    topic: String,
    classLevel: String,
    content: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('LessonNote', schema);
