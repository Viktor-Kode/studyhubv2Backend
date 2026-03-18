import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

if (!accountSid || !authToken) {
  console.warn('⚠️ TWILIO credentials not set — WhatsApp notifications disabled');
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export const sendWhatsAppTemplate = async ({ to, contentSid, contentVariables }) => {
  if (!client) {
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    const message = await client.messages.create({
      from: whatsappFrom,
      to,
      contentSid,
      contentVariables,
    });

    return { success: true, sid: message.sid };
  } catch (err) {
    console.error('[Twilio] WhatsApp error:', err?.message || err);
    return { success: false, error: err?.message || 'Unknown Twilio error' };
  }
};

export const sendTimetableWhatsApp = async ({ to, dateLabel, timeLabel }) => {
  const contentSid = process.env.TWILIO_TIMETABLE_CONTENT_SID;

  if (!contentSid) {
    console.warn('⚠️ TWILIO_TIMETABLE_CONTENT_SID not set');
    return { success: false, error: 'Timetable content SID not configured' };
  }

  const vars = {
    '1': dateLabel,
    '2': timeLabel,
  };

  return sendWhatsAppTemplate({
    to,
    contentSid,
    contentVariables: JSON.stringify(vars),
  });
};

