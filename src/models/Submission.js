import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
    examId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    answers: [{
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Question'
        },
        answer: mongoose.Schema.Types.Mixed
    }],
    score: {
        type: Number,
        default: 0
    },
    feedback: String,
    status: {
        type: String,
        enum: ['submitted', 'marked'],
        default: 'submitted'
    },
    submittedAt: {
        type: Date,
        default: Date.now
    },
    markedAt: Date
}, { timestamps: true });

const Submission = mongoose.model('Submission', submissionSchema);
export default Submission;
