import axios from 'axios';

const YCLOUD_API_URL = 'https://api.ycloud.com/v2';
const YCLOUD_API_KEY = process.env.YCLOUD_API_KEY;
const FROM_NUMBER = process.env.YCLOUD_WHATSAPP_NUMBER;

// Validate config on startup
if (!YCLOUD_API_KEY) {
    console.warn('⚠️ YCLOUD_API_KEY not set — WhatsApp notifications disabled');
}

// Format Nigerian phone numbers
const formatPhone = (phone) => {
    if (!phone) return null;
    phone = phone.replace(/[\s\-\(\)]/g, '');
    if (phone.startsWith('0')) phone = '+234' + phone.slice(1);
    if (phone.startsWith('234') && !phone.startsWith('+')) phone = '+' + phone;
    if (!phone.startsWith('+')) phone = '+' + phone;
    return phone;
};

// Core send function
const sendWhatsApp = async (to, message) => {
    if (!YCLOUD_API_KEY) {
        console.warn('YCloud not configured — skipping WhatsApp');
        return { success: false, error: 'YCloud not configured' };
    }

    const phone = formatPhone(to);
    if (!phone) {
        return { success: false, error: 'Invalid phone number' };
    }

    try {
        const response = await axios.post(
            `${YCLOUD_API_URL}/whatsapp/messages`,
            {
                from: FROM_NUMBER,
                to: phone,
                type: 'text',
                text: { body: message }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': YCLOUD_API_KEY
                }
            }
        );

        console.log('✅ YCloud WhatsApp sent:', response.data.id);
        return { success: true, messageId: response.data.id };

    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        console.error('❌ YCloud WhatsApp failed:', errMsg);
        return { success: false, error: errMsg };
    }
};

// Send template message (for pre-approved templates)
const sendWhatsAppTemplate = async (to, templateName, variables = []) => {
    if (!YCLOUD_API_KEY) return { success: false, error: 'YCloud not configured' };

    const phone = formatPhone(to);
    if (!phone) return { success: false, error: 'Invalid phone number' };

    try {
        const response = await axios.post(
            `${YCLOUD_API_URL}/whatsapp/messages`,
            {
                from: FROM_NUMBER,
                to: phone,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: 'en' },
                    components: variables.length > 0 ? [
                        {
                            type: 'body',
                            parameters: variables.map(v => ({
                                type: 'text',
                                text: String(v)
                            }))
                        }
                    ] : []
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': YCLOUD_API_KEY
                }
            }
        );

        return { success: true, messageId: response.data.id };
    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        console.error('❌ YCloud template failed:', errMsg);
        return { success: false, error: errMsg };
    }
};

// ─── StudyHelp Notification Functions ─────────────────────────

// Timetable reminder
const sendTimetableReminder = async (phone, data) => {
    const message = [
        `📚 *StudyHelp — Class Reminder*`,
        ``,
        `📌 *${data.subject}*`,
        `🕐 Time: ${data.startTime}`,
        data.topic ? `📖 Topic: ${data.topic}` : null,
        data.teacher ? `👨‍🏫 Teacher: ${data.teacher}` : null,
        ``,
        `_Good luck! — StudyHelp 🎓_`
    ].filter(Boolean).join('\n');

    return sendWhatsApp(phone, message);
};

// Study goal reminder
const sendGoalReminder = async (phone, data) => {
    const message = [
        `🎯 *StudyHelp — Goal Reminder*`,
        ``,
        `You set a goal: *${data.goalTitle}*`,
        `Progress: ${data.progress}% complete`,
        data.deadline ? `⏰ Deadline: ${data.deadline}` : null,
        ``,
        `Keep going — you're almost there! 💪`,
        `_StudyHelp 🎓_`
    ].filter(Boolean).join('\n');

    return sendWhatsApp(phone, message);
};

// CBT result notification
const sendCBTResult = async (phone, data) => {
    const emoji = data.accuracy >= 70 ? '🎉' : data.accuracy >= 50 ? '👍' : '💪';
    const message = [
        `${emoji} *StudyHelp — CBT Result*`,
        ``,
        `Subject: *${data.subject}* (${data.examType})`,
        `Score: ${data.correct}/${data.total}`,
        `Accuracy: *${data.accuracy}%*`,
        ``,
        data.accuracy >= 70
            ? `Excellent work! Keep it up! 🔥`
            : `Review your weak topics and try again. You can do it!`,
        `_StudyHelp 🎓_`
    ].filter(Boolean).join('\n');

    return sendWhatsApp(phone, message);
};

// Streak reminder (daily)
const sendStreakReminder = async (phone, data) => {
    const message = [
        `🔥 *StudyHelp — Daily Reminder*`,
        ``,
        `Your current streak: *${data.streak} days*`,
        `Don't break your streak — study something today!`,
        ``,
        data.weakSubject
            ? `💡 Suggested: Practice *${data.weakSubject}* questions`
            : `💡 Open StudyHelp and keep going!`,
        `_StudyHelp 🎓_`
    ].filter(Boolean).join('\n');

    return sendWhatsApp(phone, message);
};

// Plan expiry warning
const sendPlanExpiryWarning = async (phone, data) => {
    const message = [
        `⚠️ *StudyHelp — Plan Expiring Soon*`,
        ``,
        `Your *${data.planName}* plan expires in *${data.daysLeft} day(s)*.`,
        `Renew now to keep your progress and access:`,
        `👉 studyhelp.com/upgrade`,
        ``,
        `_StudyHelp 🎓_`
    ].filter(Boolean).join('\n');

    return sendWhatsApp(phone, message);
};

// Welcome message on signup
const sendWelcomeMessage = async (phone, name) => {
    const message = [
        `👋 *Welcome to StudyHelp, ${name}!*`,
        ``,
        `You're now set up to prepare smarter for JAMB/WAEC.`,
        ``,
        `Here's what you can do:`,
        `📝 Practice CBT questions`,
        `📇 Study with Flashcards`,
        `⏱️ Track your study time`,
        `📊 Monitor your progress`,
        ``,
        `Start practising now and aim for your best score! 🎯`,
        `_StudyHelp 🎓_`
    ].join('\n');

    return sendWhatsApp(phone, message);
};

export {
    sendWhatsApp,
    sendWhatsAppTemplate,
    sendTimetableReminder,
    sendGoalReminder,
    sendCBTResult,
    sendStreakReminder,
    sendPlanExpiryWarning,
    sendWelcomeMessage
};
