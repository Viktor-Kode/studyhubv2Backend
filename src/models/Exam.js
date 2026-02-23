import mongoose from 'mongoose';

const examSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['test', 'assignment', 'exam'],
        default: 'test'
    },
    duration: Number, // in minutes
    totalMarks: Number,
    openDate: Date,
    closeDate: Date,
    questions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
    }],
    randomize: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['draft', 'active', 'closed'],
        default: 'draft'
    }
}, { timestamps: true });

const Exam = mongoose.model('Exam', examSchema);
export default Exam;
