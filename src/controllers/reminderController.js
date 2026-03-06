import Reminder from '../models/Reminder.js';
import { sendMessage } from '../services/termiiService.js';

export const getReminders = async (req, res) => {
    try {
        const reminders = await Reminder.find({ userId: req.user._id }).sort({ date: 1, time: 1 });
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
        res.status(400).json({ success: false, message: error.message });
    }
};

export const updateReminder = async (req, res) => {
    try {
        const reminder = await Reminder.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            req.body,
            { new: true, runValidators: true }
        );
        if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found' });
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteReminder = async (req, res) => {
    try {
        const reminder = await Reminder.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found' });
        res.status(200).json({ success: true, message: 'Reminder deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const sendWhatsAppNotification = async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        if (!phoneNumber || !message) {
            return res.status(400).json({ success: false, message: 'Phone number and message are required' });
        }

        const result = await sendMessage(phoneNumber, message);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
