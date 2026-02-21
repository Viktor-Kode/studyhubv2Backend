import mongoose from 'mongoose';

const quizSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        default: function () {
            return `Quiz - ${new Date().toLocaleDateString()}`;
        }
    },
    questionType: {
        type: String,
        enum: ['multiple-choice', 'theory', 'fill-in-the-blank', 'mixed'],
        default: 'multiple-choice'
    },
    questionCount: {
        type: Number,
        required: true
    },
    questions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
    }]
}, { timestamps: true });

const QuizSession = mongoose.model('QuizSession', quizSessionSchema);

export default QuizSession;
