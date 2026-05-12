import mongoose from 'mongoose';

const studyPlanSchema = new mongoose.Schema({
    userId: {
        type: String, // using firebaseUid or mongoId? User.js says firebaseUid is unique.
        required: true,
        ref: 'User'
    },
    planType: {
        type: String,
        enum: ['exam', 'general'],
        required: true
    },
    examDetails: {
        examName: String,
        examDate: Date,
        subjects: [String],
        weakSubjects: [String],
        hoursPerDay: Number
    },
    generalDetails: {
        subject: String,
        hoursPerDay: Number,
        goal: String
    },
    tasks: [{
        date: { type: Date, required: true },
        title: { type: String, required: true },
        type: { type: String, enum: ['cbt', 'note', 'timer', 'flashcard'], required: true },
        link: { type: String, required: true },
        completed: { type: Boolean, default: false },
        completedAt: { type: Date }
    }],
    streak: { type: Number, default: 0 },
    lastActiveDate: { type: Date },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Index for performance
studyPlanSchema.index({ userId: 1, isActive: 1 });

const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);
export default StudyPlan;
