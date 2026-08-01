import Reminder from '../models/Reminder.js';
import { sendNotification } from '../services/notificationService.js';

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

        // Send instant push notification confirmation when reminder is set
        try {
            const recipientId = req.user.firebaseUid || req.user._id.toString();
            await sendNotification({
                userId: recipientId,
                type: 'timetable_reminder',
                title: `🔔 Reminder Set: ${reminder.title}`,
                body: `Scheduled for ${reminder.date} at ${reminder.time}. We'll notify you!`,
                link: '/dashboard/timetable'
            });
        } catch (pushErr) {
            console.error('[createReminder] Push notification dispatch failed:', pushErr.message);
        }

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

