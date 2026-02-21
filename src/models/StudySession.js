import mongoose from 'mongoose';

const studySessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        default: 'Productive Study Session'
    },
    type: {
        type: String,
        enum: ['study', 'break'],
        default: 'study'
    },
    startTime: {
        type: Date,
        required: true,
        default: Date.now
    },
    endTime: {
        type: Date
    },
    duration: {
        type: Number, // Stores duration in minutes
        required: true
    },
    isCompleted: {
        type: Boolean,
        default: true
    },
    tags: [{
        type: String
    }],
    notes: {
        type: String
    }
}, { timestamps: true });

const StudySession = mongoose.model('StudySession', studySessionSchema);

export default StudySession;
