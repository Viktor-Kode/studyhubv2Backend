import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema(
    {
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
        date: {
            type: String,
            required: true
        },
        time: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ['deadline', 'study', 'exam', 'other'],
            default: 'study'
        },
        completed: {
            type: Boolean,
            default: false
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        },
        description: String,
        subject: String,
        location: String,
        whatsappEnabled: {
            type: Boolean,
            default: false
        },
        sendWhatsApp: { // Alias/Backward compatibility
            type: Boolean,
            default: false
        },
        whatsappNumber: String,
        emailEnabled: {
            type: Boolean,
            default: false
        },
        notifyBefore: {
            type: Number,
            default: 15
        },
        recurring: {
            type: String,
            enum: ['none', 'daily', 'weekly', 'monthly'],
            default: 'none'
        },
        recurringDays: [Number],
        whatsappBeforeNotifiedAt: Date,
        whatsappAtTimeNotifiedAt: Date
    },
    { timestamps: true }
);

const Reminder = mongoose.model('Reminder', reminderSchema);

export default Reminder;
