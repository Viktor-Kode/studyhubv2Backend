import mongoose from 'mongoose';

const quizItemSchema = new mongoose.Schema({
  question: { type: String, default: '' },
  options: [{ type: String }],
  correctAnswerIndex: { type: Number, default: 0 },
  explanation: { type: String, default: '' },
  hint: { type: String, default: '' }
}, { _id: false });

const learningNodeSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  title: { type: String, required: true },
  unit: { type: String },                   // optional chapter/section heading
  status: { type: String, enum: ['completed', 'active', 'locked'], default: 'locked' },
  xp: { type: Number, default: 20 },
  duration: { type: String, default: '5 min' },
  slideImage: { type: String },
  sourcePages: [{ type: Number }],
  sourceFacts: [{ type: String }],
  summary: { type: String, default: '' },
  keyConcepts: [{ type: String }],
  lessonContent: {
    analogy: { type: String, default: '' },
    paragraphs: [{ type: String }],
    keyConcepts: [{ type: String }]
  },
  quiz: quizItemSchema,
  quiz2: quizItemSchema,
  finalQuiz: [quizItemSchema],
  isSummary: { type: Boolean, default: false },
  isFinalQuiz: { type: Boolean, default: false },
  nextNodeTitle: { type: String }
}, { _id: false });

const challengeQuestionSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  question: { type: String, default: '' },
  options: [{ type: String }],
  correctAnswerIndex: { type: Number, default: 0 },
  explanation: { type: String, default: '' },
  sourceNodeIds: [{ type: Number }],
  type: {
    type: String,
    enum: ['recall', 'connect', 'compare', 'sequence', 'cause-effect'],
    default: 'recall'
  },
  xp: { type: Number, default: 5 }
}, { _id: false });

const challengeAttemptSchema = new mongoose.Schema({
  score: { type: Number, default: 0 },
  total: { type: Number, default: 10 },
  passed: { type: Boolean, default: false },
  attemptXp: { type: Number, default: 0 },
  xpAwarded: { type: Number, default: 0 },
  answers: [{ type: mongoose.Schema.Types.Mixed }],
  missedNodeIds: [{ type: Number }],
  takenAt: { type: Date, default: Date.now }
}, { _id: false });

const challengeSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['locked', 'active', 'completed'],
    default: 'locked'
  },
  questions: [challengeQuestionSchema],
  generatedAt: { type: Date },
  stale: { type: Boolean, default: false },
  attempts: [challengeAttemptSchema],
  bestScore: { type: Number, default: 0 },
  bestXp: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  xp: { type: Number, default: 50 }
}, { _id: false });

const studyPathSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  topicId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  courseCode: { type: String, default: 'Study Path' },
  currentProgress: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  challenge: { type: challengeSchema, default: () => ({}) },
  nodes: [learningNodeSchema],
  isActive: { type: Boolean, default: true, index: true },
  sourceFileName: { type: String },
  extractedText: { type: String }
}, { timestamps: true });

export default mongoose.model('StudyPath', studyPathSchema);
