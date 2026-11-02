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

const studyPathSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  topicId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  courseCode: { type: String, default: 'Study Path' },
  currentProgress: { type: Number, default: 0 },
  nodes: [learningNodeSchema],
  isActive: { type: Boolean, default: true, index: true },
  sourceFileName: { type: String },
  extractedText: { type: String }
}, { timestamps: true });

export default mongoose.model('StudyPath', studyPathSchema);
