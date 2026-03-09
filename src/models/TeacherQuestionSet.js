import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
    text: { type: String, required: true },
    options: [{ type: String }],
    answer: { type: String, required: true },
    explanation: { type: String, default: '' },
    type: { type: String, enum: ['mcq', 'true_false', 'short_answer'], default: 'mcq' },
    marks: { type: Number, default: 1 },
    order: { type: Number, default: 0 }
});

const teacherQuestionSetSchema = new mongoose.Schema({
    teacherId: { type: String, required: true },
    title: { type: String, required: true },
    subject: { type: String, default: '' },
    classLevel: { type: String, default: '' },
    assessmentType: {
        type: String,
        enum: ['exam', 'test', 'assignment', 'classwork', 'quiz'],
        default: 'test'
    },
    duration: { type: Number, default: 60 },
    totalMarks: { type: Number, default: 0 },
    instructions: { type: String, default: '' },
    questions: [questionSchema],
    sourceFileName: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

teacherQuestionSetSchema.index({ teacherId: 1, createdAt: -1 });

const TeacherQuestionSet = mongoose.model('TeacherQuestionSet', teacherQuestionSetSchema);
export default TeacherQuestionSet;
