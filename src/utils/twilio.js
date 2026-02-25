import twilio from 'twilio';
import { getEnv } from '../config/env.js';

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT FACTORY
// Returns a Twilio client, or null if credentials are not configured.
// Never throws — callers should check for null before use.
// ─────────────────────────────────────────────────────────────────────────────
export const getTwilioClient = () => {
    const accountSid = getEnv('TWILIO_ACCOUNT_SID');
    const authToken = getEnv('TWILIO_AUTH_TOKEN');

    if (!accountSid || !authToken) {
        console.warn('⚠️  Twilio credentials missing. WhatsApp notifications are disabled.');
        return null;
    }

    try {
        return twilio(accountSid, authToken);
    } catch (error) {
        console.error('❌ Failed to initialize Twilio client:', error.message);
        return null;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PHONE NUMBER FORMATTER
// Ensures the number starts with + for E.164 format.
// Strips 'whatsapp:' prefix first if present (so we always re-add it cleanly).
// ─────────────────────────────────────────────────────────────────────────────
const formatPhone = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const stripped = raw.replace(/^whatsapp:/i, '').trim();
    return stripped.startsWith('+') ? stripped : `+${stripped}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE WHATSAPP SENDER
// Validates all inputs before building the Twilio message.
// Returns { success, sid } or { success: false, error } — never throws.
// ─────────────────────────────────────────────────────────────────────────────
export const sendWhatsAppMessage = async (to, message) => {
    // Guard: message body
    if (!message || typeof message !== 'string' || !message.trim()) {
        console.error('[Twilio] Attempted to send empty/undefined message body. Skipping.');
        return { success: false, error: 'Message body is empty or undefined' };
    }

    // Guard: recipient number
    const formattedTo = formatPhone(to);
    if (!formattedTo) {
        console.error('[Twilio] Invalid or missing recipient phone number:', to);
        return { success: false, error: 'Invalid recipient phone number' };
    }

    const client = getTwilioClient();
    if (!client) {
        return { success: false, error: 'Twilio not configured' };
    }

    const rawFrom = getEnv('TWILIO_PHONE_NUMBER');
    if (!rawFrom) {
        console.error('[Twilio] TWILIO_PHONE_NUMBER not set.');
        return { success: false, error: 'Sender number not configured' };
    }

    const fromNumber = formatPhone(rawFrom);

    try {
        const from = `whatsapp:${fromNumber}`;
        const to = `whatsapp:${formattedTo}`;

        console.log(`[Twilio] Sending WhatsApp: FROM=${from} TO=${to}`);

        const response = await client.messages.create({
            body: message.trim(),
            from,
            to,
        });

        console.log(`[Twilio] WhatsApp sent → ${to} | SID: ${response.sid}`);
        return { success: true, sid: response.sid };
    } catch (error) {
        console.error('[Twilio] Send error:', error.message);
        return { success: false, error: error.message };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER NOTIFICATION BUILDER
// Accepts a reminder object from MongoDB and safely builds a WhatsApp message.
// Any missing / undefined field is gracefully omitted via .filter(Boolean).
// ─────────────────────────────────────────────────────────────────────────────
export const sendWhatsAppReminder = async (phoneNumber, reminderData) => {
    if (!reminderData || typeof reminderData !== 'object') {
        console.error('[Twilio] sendWhatsAppReminder called with invalid data:', reminderData);
        return { success: false, error: 'Missing reminder data' };
    }

    if (!reminderData.title) {
        console.error('[Twilio] Reminder is missing required field "title":', reminderData);
        return { success: false, error: 'Reminder title is required' };
    }

    // Build human-readable date string safely
    let dueDateStr = null;
    if (reminderData.date || reminderData.dueDate) {
        try {
            const raw = reminderData.dueDate || `${reminderData.date} ${reminderData.time || ''}`.trim();
            dueDateStr = new Date(raw).toLocaleString('en-NG', {
                weekday: 'short', year: 'numeric', month: 'short',
                day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch {
            dueDateStr = reminderData.date || null;
        }
    }

    const lines = [
        `📚 *StudyHelp Reminder*`,
        ``,
        `📌 *${reminderData.title}*`,
        reminderData.subject ? `📖 Subject: ${reminderData.subject}` : null,
        reminderData.type ? `🏷️  Type: ${reminderData.type}` : null,
        dueDateStr ? `📅 When: ${dueDateStr}` : null,
        reminderData.priority ? `⚡ Priority: ${reminderData.priority}` : null,
        reminderData.description ? `📝 ${reminderData.description}` : null,
        ``,
        `_StudyHelp – Study Smarter_ 🎓`,
    ].filter(Boolean); // remove all null/undefined lines

    const message = lines.join('\n');
    return sendWhatsAppMessage(phoneNumber, message);
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMETABLE / CLASS ALERT BUILDER
// Accepts a timetable slot object and sends a "class starting soon" alert.
// ─────────────────────────────────────────────────────────────────────────────
export const sendTimetableAlert = async (phoneNumber, slot) => {
    if (!slot || typeof slot !== 'object') {
        console.error('[Twilio] sendTimetableAlert called with invalid slot:', slot);
        return { success: false, error: 'Missing timetable slot data' };
    }

    if (!slot.subject) {
        console.error('[Twilio] Timetable slot missing "subject" field:', slot);
        return { success: false, error: 'Timetable slot must have a subject' };
    }

    let startTimeStr = null;
    if (slot.startTime) {
        try {
            startTimeStr = new Date(slot.startTime).toLocaleString('en-NG', {
                weekday: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch {
            startTimeStr = slot.startTime;
        }
    }

    const lines = [
        `🔔 *Class Starting Soon!*`,
        ``,
        `📖 *${slot.subject}*`,
        slot.topic ? `📝 Topic: ${slot.topic}` : null,
        startTimeStr ? `⏰ Time: ${startTimeStr}` : null,
        slot.room ? `📍 Room: ${slot.room}` : null,
        slot.teacher ? `👨‍🏫 Teacher: ${slot.teacher}` : null,
        ``,
        `_StudyHelp – Study Smarter_ 🎓`,
    ].filter(Boolean);

    const message = lines.join('\n');
    return sendWhatsAppMessage(phoneNumber, message);
};
