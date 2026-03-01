import mongoose from 'mongoose';

const StudyGuideSchema = new mongoose.Schema({
    title: { type: String, required: true },
    subject: {
        type: String,
        enum: ['english', 'mathematics', 'biology'],
        required: true
    },
    examType: {
        type: String,
        enum: ['JAMB', 'WAEC', 'NECO'],
        default: 'JAMB'
    },
    topic: { type: String, required: true },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        required: true
    },
    estimatedReadTime: { type: Number }, // in minutes — auto computed
    content: { type: String, required: true }, // markdown format
    summary: { type: String, required: true },
    keyPoints: [{ type: String }], // array of bullet points
    isPremium: { type: Boolean, default: false },
    relatedQuestionIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LibraryQuestion'
    }],
    relatedTopic: { type: String }, // for "Practice Now" deep link
    validated: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Text index for search
StudyGuideSchema.index({
    title: 'text',
    content: 'text',
    topic: 'text'
});

// Fast filtering index
StudyGuideSchema.index({ subject: 1, topic: 1, examType: 1, isPremium: 1 });

// Auto-compute read time before save
StudyGuideSchema.pre('save', function (next) {
    const wordCount = this.content.split(' ').length;
    this.estimatedReadTime = Math.max(1, Math.ceil(wordCount / 200)); // 200 wpm
    this.updatedAt = new Date();
    next();
});

const StudyGuide = mongoose.model('StudyGuide', StudyGuideSchema);
export default StudyGuide;
