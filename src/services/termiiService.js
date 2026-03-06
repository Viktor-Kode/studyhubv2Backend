import axios from 'axios';

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const SENDER_ID = process.env.TERMII_SENDER_ID || 'StudyHelp';
const BASE_URL = 'https://v3.api.termii.com/api';

if (!TERMII_API_KEY) {
  console.warn('⚠️ TERMII_API_KEY not set — notifications disabled');
}

// Format Nigerian phone number (Termii uses format without + e.g. 2348012345678)
const formatPhone = (phone) => {
  if (!phone) return null;
  phone = String(phone).replace(/^whatsapp:/i, '').replace(/[\s\-\(\)]/g, '');
  if (phone.startsWith('0')) phone = '234' + phone.slice(1);
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (!phone.startsWith('234') || phone.length < 13) return null;
  return phone;
};

// Core send function — tries WhatsApp first, falls back to SMS
export const sendMessage = async (to, message) => {
  if (!TERMII_API_KEY) {
    console.warn('[Termii] API key not set — skipping');
    return { success: false, error: 'Not configured' };
  }

  const phone = formatPhone(to);
  if (!phone) {
    console.error('[Termii] Invalid phone:', to);
    return { success: false, error: 'Invalid phone number' };
  }

  const whatsappResult = await sendWhatsApp(phone, message);
  if (whatsappResult.success) return whatsappResult;

  console.log('[Termii] WhatsApp failed, falling back to SMS...');
  return sendSMS(phone, message);
};

// Send via WhatsApp
const sendWhatsApp = async (phone, message) => {
  try {
    const response = await axios.post(`${BASE_URL}/sms/send`, {
      api_key: TERMII_API_KEY,
      to: phone,
      from: SENDER_ID,
      sms: message,
      type: 'unicode',
      channel: 'whatsapp',
    });

    console.log('[Termii] WhatsApp sent:', response.data);
    return { success: true, channel: 'whatsapp', data: response.data };
  } catch (err) {
    console.error('[Termii] WhatsApp error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data };
  }
};

// Send via SMS fallback (dnd for transactional reliability in Nigeria)
const sendSMS = async (phone, message) => {
  try {
    const response = await axios.post(`${BASE_URL}/sms/send`, {
      api_key: TERMII_API_KEY,
      to: phone,
      from: SENDER_ID,
      sms: message,
      type: 'plain',
      channel: 'dnd',
    });

    console.log('[Termii] SMS sent:', response.data);
    return { success: true, channel: 'sms', data: response.data };
  } catch (err) {
    console.error('[Termii] SMS error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data };
  }
};

// ─── StudyHelp Notification Functions ─────────────────────

export const sendWelcomeMessage = async (phone, name) => {
  const message = `Welcome to StudyHelp, ${name}!\n\nYou are now set up to prepare smarter for JAMB/WAEC.\n\nStart practising now and aim for your best score!\n\nstudyhelp.com`;
  return sendMessage(phone, message);
};

export const sendCBTResult = async (phone, data) => {
  const emoji =
    data.accuracy >= 70 ? 'Excellent' : data.accuracy >= 50 ? 'Good effort' : 'Keep practising';
  const message = `StudyHelp CBT Result\n\nSubject: ${data.subject} (${data.examType})\nScore: ${data.correct}/${data.total}\nAccuracy: ${data.accuracy}%\n\n${emoji}! Keep going.\n\nstudyhelp.com`;
  return sendMessage(phone, message);
};

export const sendStreakReminder = async (phone, data) => {
  const message = `StudyHelp Reminder\n\nYour current streak: ${data.streak} days\n\nDon't break your streak — study something today!\n\n${data.weakSubject ? `Suggested: Practice ${data.weakSubject} questions` : 'Open StudyHelp and keep going!'}\n\nstudyhelp.com`;
  return sendMessage(phone, message);
};

export const sendGoalReminder = async (phone, data) => {
  const message = `StudyHelp Goal Reminder\n\nGoal: ${data.goalTitle}\nProgress: ${data.progress}% complete${data.deadline ? `\nDeadline: ${data.deadline}` : ''}\n\nKeep going, you are almost there!\n\nstudyhelp.com`;
  return sendMessage(phone, message);
};

export const sendPlanExpiryWarning = async (phone, data) => {
  const message = `StudyHelp Notice\n\nYour ${data.planName} plan expires in ${data.daysLeft} day(s).\n\nRenew now to keep your progress:\nstudyhelp.com/upgrade`;
  return sendMessage(phone, message);
};

export const sendTimetableReminder = async (phone, data) => {
  const message = `StudyHelp Class Reminder\n\nSubject: ${data.subject}\nTime: ${data.startTime}${data.topic ? `\nTopic: ${data.topic}` : ''}${data.teacher ? `\nTeacher: ${data.teacher}` : ''}\n\nGood luck!\n\nstudyhelp.com`;
  return sendMessage(phone, message);
};

// Check wallet balance
export const checkBalance = async () => {
  try {
    const response = await axios.get(
      `${BASE_URL}/get-balance?api_key=${TERMII_API_KEY}`
    );
    console.log('[Termii] Balance:', response.data);
    return response.data;
  } catch (err) {
    console.error('[Termii] Balance check error:', err.message);
    return null;
  }
};
