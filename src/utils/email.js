import nodemailer from 'nodemailer';

const sendEmail = async (options) => {
    const user = process.env.EMAIL_USERNAME;
    const pass = process.env.EMAIL_PASSWORD;
    const from = process.env.EMAIL_FROM;

    if (!user || !pass || user === 'undefined' || pass === 'undefined') {
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ CRITICAL: EMAIL_USERNAME or EMAIL_PASSWORD missing in production!');
        } else {
            console.warn('⚠️ Warning: Email credentials not set. Email delivery disabled.');
        }
        return; // Return silently to prevent crashing the server
    }

    // 1) Create a transporter
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: { user, pass }
    });

    // 2) Define the email options
    const mailOptions = {
        from: `StudyHelp <${from || user}>`,
        to: options.email,
        subject: options.subject,
        text: options.message
    };

    // 3) Actually send the email
    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('❌ Email failed to send:', error.message);
    }
};

export default sendEmail;

