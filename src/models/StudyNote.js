import mongoose from 'mongoose';

const studyNoteSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    sourceFileName: {
        type: String
    },
    tags: [{
        type: String
    }]
}, { timestamps: true });

const StudyNote = mongoose.model('StudyNote', studyNoteSchema);

export default StudyNote;
