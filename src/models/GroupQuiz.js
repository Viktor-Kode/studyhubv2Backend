import mongoose from 'mongoose';

const GroupQuizSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGroup', required: true, index: true },
    question: { type: String, required: true, maxlength: 2000 },
    options: [{ type: String, maxlength: 500 }],
    correctOption: { type: Number, required: true, min: 0 },
    explanation: { type: String, maxlength: 3000, default: '' },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    answeredBy: [
      {
        userId: { type: String, required: true },
        answer: { type: Number, required: true },
        correct: { type: Boolean, required: true },
        answeredAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

GroupQuizSchema.index({ groupId: 1, createdAt: -1 });

const GroupQuiz = mongoose.model('GroupQuiz', GroupQuizSchema);
export default GroupQuiz;
