import { Resend } from 'resend';
import { getEnv } from '../config/env.js';

const RESEND_API_KEY = getEnv('RESEND_API_KEY');
const FROM_EMAIL = getEnv('FROM_EMAIL', 'notifications@studyhelp.site');
const FROM_NAME = 'StudyHelp';

// ── Send single email ─────────────────────────────────
export const sendEmail = async ({ to, subject, html }) => {
    try {
        if (!RESEND_API_KEY) {
            console.warn('[Email] RESEND_API_KEY not set. Skipping send.');
            return { success: false, error: 'Email service not configured' };
        }

        const resend = new Resend(RESEND_API_KEY);
        
        const { data, error } = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to,
            subject,
            html: html
        });

        if (error) {
            console.error('[Email] Resend error:', error);
            return { success: false, error: error.message || 'Send failed' };
        }

        console.log('[Email] Sent successfully. ID:', data.id);
        return { success: true, id: data.id };
    } catch (err) {
        console.error('[Email] Failed:', err.message);
        return { success: false, error: err.message };
    }
};

// ── Send bulk emails in batches ───────────────────────
export const sendBulkEmail = async (recipients, subject, html) => {
    const results = { sent: 0, failed: 0, errors: [] };
    const batchSize = 10;
    
    // We use a singleton-like instance for the bulk operation if possible, 
    // but the sendEmail function already creates one. That's fine for small batches.

    for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        await Promise.all(batch.map(async (recipient) => {
            const personalised = html
                .replace(/{{name}}/g, recipient.name?.split(' ')[0] || 'there')
                .replace(/{{email}}/g, recipient.email);

            const result = await sendEmail({
                to: recipient.email,
                subject,
                html: personalised
            });

            if (result.success) results.sent++;
            else {
                results.failed++;
                results.errors.push({ email: recipient.email, error: result.error });
            }
        }));

        // Small delay between batches to respect rate limits
        if (i + batchSize < recipients.length) {
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`[Bulk Email] Batch ${Math.floor(i / batchSize) + 1} done — Sent: ${results.sent}, Failed: ${results.failed}`);
    }

    return results;
};

// ── Templates (Refined with Premium Aesthetics) ────────
export const upgradeEmailTemplate = () => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:24px 24px 0 0;padding:60px 40px;text-align:center;box-shadow:0 10px 25px rgba(59,130,246,0.15);">
      <h1 style="color:white;font-size:32px;font-weight:900;margin:0 0 12px;letter-spacing:-0.5px;">StudyHelp</h1>
      <p style="color:rgba(255,255,255,0.9);font-size:18px;margin:0;font-weight:500;">Your AI-Powered Academic Edge</p>
    </div>
    <div style="background-color:#ffffff;padding:40px;border-radius:0 0 24px 24px;border:1px solid #e2e8f0;border-top:none;box-shadow:0 20px 40px rgba(0,0,0,0.05);">
      <p style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">Hello {{name}} 👋</p>
      <p style="font-size:16px;color:#475569;line-height:1.7;margin:0 0 24px;">
        You've been making great progress on StudyHelp! But did you know you're only seeing a fraction of what our platform can do? 
      </p>
      
      <div style="background-color:#eff6ff;border:1px dashed #bfdbfe;border-radius:18px;padding:24px;margin-bottom:32px;">
        <p style="font-size:14px;font-weight:800;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px;">Unlock Your Full Potential:</p>
        <div style="display:grid;gap:12px;">
          <div style="display:flex;align-items:center;margin-bottom:10px;">
            <span style="color:#2563eb;margin-right:12px;">✓</span>
            <span style="color:#334155;font-size:15px;"><strong>Unlimited</strong> CBT Mock Exams</span>
          </div>
          <div style="display:flex;align-items:center;margin-bottom:10px;">
            <span style="color:#2563eb;margin-right:12px;">✓</span>
            <span style="color:#334155;font-size:15px;"><strong>250+</strong> AI-Generated Explanations</span>
          </div>
          <div style="display:flex;align-items:center;margin-bottom:10px;">
            <span style="color:#2563eb;margin-right:12px;">✓</span>
            <span style="color:#334155;font-size:15px;"><strong>Premium</strong> Study Group Access</span>
          </div>
          <div style="display:flex;align-items:center;">
            <span style="color:#2563eb;margin-right:12px;">✓</span>
            <span style="color:#334155;font-size:15px;">Advanced Performance Analytics</span>
          </div>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:32px;">
        <a href="https://www.studyhelp.site/dashboard/upgrade"
          style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;font-size:18px;font-weight:700;padding:20px 48px;border-radius:16px;text-decoration:none;box-shadow:0 10px 20px rgba(37,99,235,0.25);">
          Upgrade My Account Now →
        </a>
        <p style="font-size:13px;color:#94a3b8;margin:16px 0 0;">Secure payment. One-time fee, no subscriptions.</p>
      </div>

      <hr style="border:none;border-top:1px solid #f1f5f9;margin:32px 0;">

      <p style="font-size:14px;color:#64748b;line-height:1.6;margin:0;">
        Study smart, not hard. Join the thousands of students who are acing their JAMB, WAEC, and Post-UTME exams with our premium tools.
      </p>
      <p style="font-size:14px;font-weight:600;color:#1e293b;margin:20px 0 0;">— The StudyHelp Team</p>
    </div>
    <div style="text-align:center;padding:32px;font-size:12px;color:#94a3b8;line-height:1.6;">
      <p style="margin:0;">You are receiving this because you are a valued member of StudyHelp.</p>
      <div style="margin-top:12px;">
        <a href="https://www.studyhelp.site/unsubscribe?email={{email}}" style="color:#3b82f6;text-decoration:none;font-weight:600;">Unsubscribe</a>
        <span style="margin:0 8px;">•</span>
        <a href="https://www.studyhelp.site/privacy" style="color:#94a3b8;text-decoration:none;">Privacy Policy</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

export const teacherUpgradeEmailTemplate = () => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:linear-gradient(135deg,#059669,#0d9488);border-radius:24px 24px 0 0;padding:60px 40px;text-align:center;box-shadow:0 10px 25px rgba(5,150,105,0.15);">
      <h1 style="color:white;font-size:28px;font-weight:900;margin:0 0 12px;letter-spacing:-0.5px;">StudyHelp for Educators</h1>
      <p style="color:rgba(255,255,255,0.9);font-size:16px;margin:0;font-weight:500;">AI Tools Optimized for Professional Teaching</p>
    </div>
    <div style="background-color:#ffffff;padding:40px;border-radius:0 0 24px 24px;border:1px solid #e2e8f0;border-top:none;box-shadow:0 20px 40px rgba(0,0,0,0.05);">
      <p style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 16px;">Hello {{name}} 👋</p>
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        As a teacher, your time is your most precious resource. Our premium educator plan is designed to give you hours of your life back every single week.
      </p>
      
      <div style="background-color:#f0fdf4;border-left:4px solid #10b981;border-radius:8px;padding:24px;margin-bottom:32px;">
        <p style="font-size:14px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:1px;margin:0 0- 12px;">Premium Educator Toolkit:</p>
        <ul style="font-size:14px;color:#334155;line-height:2.2;padding-left:0;list-style:none;margin:0;">
          <li>✨ <strong>Instant Lesson Notes</strong>: High-quality notes in seconds.</li>
          <li>🎯 <strong>Result Compiler</strong>: Process class results automatically.</li>
          <li>📝 <strong>30+ Report Comments</strong>: Personalised feedback in one click.</li>
          <li>📅 <strong>Scheme of Work</strong>: Full term planning with AI.</li>
          <li>📖 <strong>Comprehension Builder</strong>: Dynamic reading assessments.</li>
        </ul>
      </div>

      <div style="text-align:center;margin-bottom:32px;">
        <a href="https://www.studyhelp.site/teacher/upgrade"
          style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:white;font-size:18px;font-weight:700;padding:18px 44px;border-radius:14px;text-decoration:none;box-shadow:0 10px 20px rgba(16,185,129,0.2);">
          Boost My Productivity →
        </a>
      </div>

      <p style="font-size:14px;color:#64748b;line-height:1.6;margin:0;">
        Join hundreds of educators who have transformed their teaching workflow with StudyHelp.
      </p>
      <p style="font-size:14px;font-weight:600;color:#0f172a;margin:16px 0 0;">— The StudyHelp Team</p>
    </div>
    <div style="text-align:center;padding:24px;font-size:11px;color:#94a3b8;">
      <p style="margin:0;">Sent with ❤️ for educators everywhere.</p>
      <p style="margin:8px 0 0;">
        <a href="https://www.studyhelp.site/unsubscribe?email={{email}}" style="color:#059669;text-decoration:none;">Unsubscribe</a> from these updates.
      </p>
    </div>
  </div>
</body>
</html>
`;
