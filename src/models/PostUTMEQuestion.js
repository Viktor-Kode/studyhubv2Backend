import mongoose from 'mongoose';

const postUTMEQuestionSchema = new mongoose.Schema({
  universityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'University',
    required: true
  },
  universitySlug: { type: String, required: true },
  subject: { type: String, required: true },
  year: { type: Number, required: true },
  questionNumber: { type: Number },
  questionText: { type: String, required: true },
  options: {
    A: { type: String },
    B: { type: String },
    C: { type: String },
    D: { type: String }
  },
  correctAnswer: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    required: true
  },
  explanation: { type: String, default: null },
  image: { type: String, default: null },
  topic: { type: String, default: null },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  source: {
    type: String,
    enum: ['manual', 'AI-generated', 'scraped'],
    default: 'AI-generated'
  },
  validated: { type: Boolean, default: false }
}, { timestamps: true });

postUTMEQuestionSchema.index({ universitySlug: 1, subject: 1, year: 1 });
postUTMEQuestionSchema.index({ universitySlug: 1, validated: 1 });

const PostUTMEQuestion = mongoose.model('PostUTMEQuestion', postUTMEQuestionSchema);
export default PostUTMEQuestion;
