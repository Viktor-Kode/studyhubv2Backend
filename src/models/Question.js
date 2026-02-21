import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['multiple-choice', 'theory', 'fill-in-the-blank', 'mixed', 'subjective'],
    default: 'multiple-choice'
  },
  options: [String], // Will hold choices for MCQ
  answer: {
    type: mongoose.Schema.Types.Mixed // Can be the index (0-3) or a string
  },
  knowledgeDeepDive: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    default: 'General Study'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  }
}, { timestamps: true });

const Question = mongoose.model('Question', questionSchema);

export default Question;