import mongoose from 'mongoose';

const CBTQuestionSchema = new mongoose.Schema({
    subject: { type: String, required: true },
    year: { type: String },
    examType: { type: String, required: true }, // JAMB, WAEC, BECE, NECO
    questionNumber: { type: Number },
    questionText: { type: String, required: true },
    options: [String],
    correctAnswer: { type: String },
    explanation: { type: String, default: null }, // cached AI explanation
    source: { type: String, default: 'API' },    // 'API' or 'internal'
    createdAt: { type: Date, default: Date.now }
});

// Prevent duplicates
CBTQuestionSchema.index(
    { subject: 1, year: 1, examType: 1, questionNumber: 1 },
    { unique: true }
);

const CBTQuestion = mongoose.model('CBTQuestion', CBTQuestionSchema);
export default CBTQuestion;
