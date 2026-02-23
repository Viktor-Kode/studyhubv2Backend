import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    fileType: String,
    storagePath: String,
    extractedText: String,
    flashcards: [{
        front: String,
        back: String
    }],
    summary: String
}, { timestamps: true });

const Resource = mongoose.model('Resource', resourceSchema);
export default Resource;
