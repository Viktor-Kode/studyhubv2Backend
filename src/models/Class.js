import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

const classSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    className: {
        type: String,
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    level: {
        type: String,
        enum: ['secondary', 'university'],
        required: true
    },
    joinCode: {
        type: String,
        unique: true
    },
    students: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, { timestamps: true });

classSchema.pre('save', function (next) {
    if (!this.joinCode) {
        this.joinCode = nanoid();
    }
    next();
});

const Class = mongoose.model('Class', classSchema);
export default Class;
