import { sendEmail as sendHtmlEmail } from '../services/emailService.js';
import { getEnv } from '../config/env.js';

const sendEmail = async (options) => {
    if (!getEnv('RESEND_API_KEY')) {
        if (getEnv('NODE_ENV') === 'production') {
            console.error('❌ CRITICAL: RESEND_API_KEY missing in production!');
        } else {
            console.warn('⚠️ Warning: RESEND_API_KEY not set. Email delivery disabled.');
        }
        return;
    }

    const subject = options.subject;
    const text = options.message;
    const html = `<pre style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; white-space:pre-wrap;">${text}</pre>`;

    try {
        await sendHtmlEmail({
            to: options.email,
            subject,
            html
        });
    } catch (error) {
        console.error('❌ Email failed to send via Resend:', error.message);
    }
};

export default sendEmail;

