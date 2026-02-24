import twilio from 'twilio';
import { getEnv } from '../config/env.js';

/**
 * Safely initializes the Twilio client with graceful failure
 */
export const getTwilioClient = () => {
    const accountSid = getEnv('TWILIO_ACCOUNT_SID');
    const authToken = getEnv('TWILIO_AUTH_TOKEN');

    if (!accountSid || !authToken) {
        if (getEnv('NODE_ENV') === 'production') {
            console.warn('⚠️ WARNING: Twilio credentials missing in production! SMS/WhatsApp features are disabled.');
        } else {
            console.log('ℹ️ Information: Twilio credentials not set. SMS/WhatsApp features disabled.');
        }
        return null;
    }

    try {
        return twilio(accountSid, authToken);
    } catch (error) {
        console.error('❌ Failed to initialize Twilio client:', error.message);
        return null;
    }
};

/**
 * Sends a WhatsApp message Safely
 */
export const sendWhatsAppMessage = async (to, message) => {
    const client = getTwilioClient();
    const from = getEnv('TWILIO_PHONE_NUMBER');


    if (!client) {
        console.error('❌ Cannot send WhatsApp: Twilio client not initialized.');
        return { success: false, error: 'Twilio not configured' };
    }

    if (!from) {
        console.error('❌ Cannot send WhatsApp: TWILIO_PHONE_NUMBER missing.');
        return { success: false, error: 'Sender number not configured' };
    }

    try {
        const response = await client.messages.create({
            body: message,
            from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
            to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
        });
        return { success: true, sid: response.sid };
    } catch (error) {
        console.error('❌ Twilio Send Error:', error.message);
        return { success: false, error: error.message };
    }
};
