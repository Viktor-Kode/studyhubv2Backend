import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: false // Optional if global bank
  },
  subject: {
    type: String,
    required: true
  },
  topic: String,
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  type: {
    type: String,
    enum: ['obj', 'theory', 'fill-blank', 'mixed'],
    required: true
  },
  question: {
    type: String,
    required: true
  },
  options: [String], // for objective questions
  correctAnswer: String,
  modelAnswer: String,
  workingSolution: String,
  markingScheme: String,
  subMarks: [{
    criterion: String,
    marks: Number
  }],
  totalMarks: {
    type: Number,
    required: true,
    default: 1
  },
  source: {
    type: String,
    enum: ['AI', 'manual', 'upload'],
    default: 'manual'
  }
}, { timestamps: true });

const Question = mongoose.model('Question', questionSchema);
export default Question;