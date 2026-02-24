import Reminder from '../models/Reminder.js';
import { sendWhatsAppMessage, sendWhatsAppReminder } from '../utils/twilio.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET all reminders for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
export const getReminders = async (req, res) => {
    try {
        const reminders = await Reminder.find({ userId: req.user._id }).sort({ date: 1, time: 1 });
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        console.error('[Reminders] getReminders error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE a reminder and optionally send a WhatsApp confirmation
// ─────────────────────────────────────────────────────────────────────────────
export const createReminder = async (req, res) => {
    try {
        const reminder = await Reminder.create({
            ...req.body,
            userId: req.user._id,
        });

        // Send WhatsApp confirmation if user opted in and has a phone number
        if (reminder.sendWhatsApp && reminder.whatsappNumber) {
            const notifData = {
                title: reminder.title,
                subject: reminder.subject || null,
                type: reminder.type || null,
                date: reminder.date || null,
                time: reminder.time || null,
                priority: reminder.priority || null,
                description: reminder.description || null,
            };

            // Fire-and-forget — don't fail the HTTP response if WhatsApp fails
            sendWhatsAppReminder(reminder.whatsappNumber, notifData)
                .then(result => {
                    if (!result.success) {
                        console.warn('[Reminders] WhatsApp notification failed:', result.error);
                    }
                })
                .catch(err => console.error('[Reminders] WhatsApp send threw:', err.message));
        }

        res.status(201).json({ success: true, reminder });
    } catch (error) {
        console.error('[Reminders] createReminder error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to create reminder' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE a reminder
// ─────────────────────────────────────────────────────────────────────────────
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
        console.error('[Reminders] updateReminder error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update reminder' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE a reminder
// ─────────────────────────────────────────────────────────────────────────────
export const deleteReminder = async (req, res) => {
    try {
        const result = await Reminder.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Reminder not found' });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[Reminders] deleteReminder error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete reminder' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reminders/whatsapp
// Manually send a WhatsApp notification for a specific reminder
// Body: { reminderId } OR { phoneNumber, message, reminderTitle }
// ─────────────────────────────────────────────────────────────────────────────
export const sendWhatsApp = async (req, res) => {
    const { reminderId, phoneNumber, message, reminderTitle } = req.body;

    // ── Path A: send by reminderId (preferred — fetches from DB for safety) ──
    if (reminderId) {
        const reminder = await Reminder.findOne({ _id: reminderId, userId: req.user._id });
        if (!reminder) {
            return res.status(404).json({ success: false, error: 'Reminder not found' });
        }

        const phone = phoneNumber || reminder.whatsappNumber;
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'No phone number provided and reminder has no whatsappNumber set',
            });
        }

        const notifData = {
            title: reminder.title,
            subject: reminder.subject || null,
            type: reminder.type || null,
            date: reminder.date || null,
            time: reminder.time || null,
            priority: reminder.priority || null,
            description: reminder.description || null,
        };

        const result = await sendWhatsAppReminder(phone, notifData);
        return res.status(result.success ? 200 : 502).json(result);
    }

    // ── Path B: legacy — raw phoneNumber + message / title ────────────────
    if (!phoneNumber || (!message && !reminderTitle)) {
        return res.status(400).json({
            success: false,
            error: 'Provide either reminderId, or both phoneNumber and message/reminderTitle',
        });
    }

    const body = message || `📚 Study Reminder: ${reminderTitle}`;
    const result = await sendWhatsAppMessage(phoneNumber, body);
    return res.status(result.success ? 200 : 502).json(result);
};
