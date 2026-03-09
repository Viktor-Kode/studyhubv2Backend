import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema({
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    className: String,
    subject: String,
    term: String,
    year: String,
    gradingType: String,
    caWeight: Number,
    examWeight: Number,
    students: [mongoose.Schema.Types.Mixed],
    stats: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Result', resultSchema);
