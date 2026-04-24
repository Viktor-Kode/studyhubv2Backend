import mongoose from 'mongoose';

const cbtResultSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    examType: {
        type: String,
        required: true
    },
    year: {
        type: String
    },
    totalQuestions: {
        type: Number,
        required: true
    },
    correctAnswers: {
        type: Number,
        required: true
    },
    wrongAnswers: {
        type: Number,
        required: true
    },
    skipped: {
        type: Number,
        default: 0
    },
    accuracy: {
        type: Number, // Percentage
        required: true
    },
    timeTaken: {
        type: Number // seconds
    },
    answers: [{
        questionId: String,
        question: String,
        selectedAnswer: String,
        correctAnswer: String,
        explanation: String,
        isCorrect: Boolean
    }],
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuizSession',
        required: false
    },
    takenAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for performance
cbtResultSchema.index({ studentId: 1, takenAt: -1 });

const CBTResult = mongoose.model('CBTResult', cbtResultSchema);

export default CBTResult;
