import Reminder from '../models/Reminder.js';
import { sendWhatsAppMessage } from '../utils/twilio.js';

export const getReminders = async (req, res) => {
    try {
        const reminders = await Reminder.find({ userId: req.user._id }).sort({ date: 1, time: 1 });
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
    }
};

export const createReminder = async (req, res) => {
    try {
        const reminder = await Reminder.create({
            ...req.body,
            userId: req.user._id
        });
        res.status(201).json({ success: true, reminder });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to create reminder' });
    }
};

export const updateReminder = async (req, res) => {
    try {
        const reminder = await Reminder.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            req.body,
            { new: true }
        );
        if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to update reminder' });
    }
};

export const deleteReminder = async (req, res) => {
    try {
        const result = await Reminder.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Reminder not found' });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete reminder' });
    }
};

export const sendWhatsApp = async (req, res) => {
    const { phoneNumber, message, reminderTitle } = req.body;

    if (!phoneNumber || (!message && !reminderTitle)) {
        return res.status(400).json({ success: false, error: 'Phone number and message/title are required' });
    }

    try {
        const result = await sendWhatsAppMessage(
            phoneNumber,
            message || `📚 Study Reminder: ${reminderTitle}`
        );

        if (result.success) {
            res.status(200).json({ success: true, sid: result.sid });
        } else {
            res.status(502).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
