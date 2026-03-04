import mongoose from 'mongoose';

const postUTMEResultSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'University' },
  universitySlug: { type: String },
  universityName: { type: String },
  subject: { type: String },
  year: { type: Number },
  totalQuestions: { type: Number },
  correctAnswers: { type: Number },
  wrongAnswers: { type: Number },
  skipped: { type: Number },
  accuracy: { type: Number },
  timeTaken: { type: Number },
  answers: [{
    questionId: mongoose.Schema.Types.ObjectId,
    questionText: String,
    selectedAnswer: String,
    correctAnswer: String,
    explanation: String,
    isCorrect: Boolean
  }],
  takenAt: { type: Date, default: Date.now }
}, { timestamps: true });

postUTMEResultSchema.index({ studentId: 1, takenAt: -1 });

const PostUTMEResult = mongoose.model('PostUTMEResult', postUTMEResultSchema);
export default PostUTMEResult;
