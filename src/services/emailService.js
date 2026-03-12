import { Resend } from 'resend';
import { getEnv } from '../config/env.js';

const resend = new Resend(getEnv('RESEND_API_KEY'));
const FROM = getEnv('EMAIL_FROM') || 'onboarding@resend.dev';

// ── Send single email ─────────────────────────────────
export const sendEmail = async ({ to, subject, html }) => {
    try {
        if (!getEnv('RESEND_API_KEY')) {
            console.warn('[Email] RESEND_API_KEY not set. Skipping send.');
            return { success: false, error: 'Email not configured' };
        }

        const { data, error } = await resend.emails.send({
            from: `StudyHelp <${FROM}>`,
            to,
            subject,
            html
        });

        if (error) {
            console.error('[Email] Resend error:', error);
            return { success: false, error: error.message };
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
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`[Bulk Email] Batch ${Math.floor(i / batchSize) + 1} done — Sent: ${results.sent}, Failed: ${results.failed}`);
    }

    return results;
};

// ── Templates ─────────────────────────────────────────
export const upgradeEmailTemplate = ({ planHighlight = 'monthly' } = {}) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:16px 16px 0 0;padding:40px 32px;text-align:center;">
      <h1 style="color:white;font-size:28px;font-weight:900;margin:0 0 8px;">StudyHelp</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:16px;margin:0;">Study Smarter. Score Higher.</p>
    </div>
    <div style="background:white;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E5E7EB;border-top:none;">
      <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Hi {{name}} 👋</p>
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">
        You've been using StudyHelp on the free plan. We want to make sure you have
        <strong>everything you need</strong> to ace your exams.
      </p>
      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="font-size:13px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;">What you're missing on the free plan:</p>
        <ul style="margin:0;padding-left:20px;color:#78350F;font-size:14px;line-height:2;">
          <li>Unlimited CBT practice tests</li>
          <li>AI question generation</li>
          <li>Full analytics and progress tracking</li>
          <li>Unlimited flashcard reviews</li>
        </ul>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="48%" style="padding-right:8px;vertical-align:top;">
            <div style="border:2px solid #E5E7EB;border-radius:12px;padding:16px;text-align:center;">
              <p style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;margin:0 0 6px;">Weekly</p>
              <p style="font-size:28px;font-weight:900;color:#111827;margin:0 0 4px;">₦600</p>
              <p style="font-size:12px;color:#9CA3AF;margin:0 0 12px;">per week</p>
              <p style="font-size:12px;color:#374151;margin:0;">80 AI questions + Unlimited CBT</p>
            </div>
          </td>
          <td width="48%" style="padding-left:8px;vertical-align:top;">
            <div style="border:2px solid #4F46E5;border-radius:12px;padding:16px;text-align:center;background:#FAFBFF;">
              <div style="background:#4F46E5;color:white;font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;display:inline-block;margin-bottom:8px;">⭐ BEST VALUE</div>
              <p style="font-size:12px;font-weight:700;color:#4F46E5;text-transform:uppercase;margin:0 0 6px;">Monthly</p>
              <p style="font-size:28px;font-weight:900;color:#111827;margin:0 0 4px;">₦2,300</p>
              <p style="font-size:12px;color:#9CA3AF;margin:0 0 12px;">per month</p>
              <p style="font-size:12px;color:#374151;margin:0;">250 AI questions + Everything unlocked</p>
            </div>
          </td>
        </tr>
      </table>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app'}/upgrade"
          style="display:inline-block;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;font-size:16px;font-weight:800;padding:16px 40px;border-radius:12px;text-decoration:none;">
          Upgrade My Account →
        </a>
        <p style="font-size:12px;color:#9CA3AF;margin:12px 0 0;">No auto-renewal. Pay once, study unlimited.</p>
      </div>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0;">
        Your exams are coming. Make sure you're ready. 💪
      </p>
      <p style="font-size:14px;color:#374151;margin:8px 0 0;">— The StudyHelp Team</p>
    </div>
    <div style="text-align:center;padding:20px;font-size:12px;color:#9CA3AF;">
      <p style="margin:0;">You're receiving this because you signed up with {{email}}.</p>
      <p style="margin:4px 0 0;">
        <a href="${getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app'}/unsubscribe?email={{email}}" style="color:#9CA3AF;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
`;

export const teacherUpgradeEmailTemplate = () => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#059669,#0891B2);border-radius:16px 16px 0 0;padding:40px 32px;text-align:center;">
      <h1 style="color:white;font-size:26px;font-weight:900;margin:0 0 8px;">StudyHelp for Teachers</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:15px;margin:0;">Save hours every week. Teach better.</p>
    </div>
    <div style="background:white;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E5E7EB;border-top:none;">
      <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 16px;">Hi {{name}} 👋</p>
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">
        Here's what the <strong>full Teacher Plan</strong> unlocks:
      </p>
      <ul style="font-size:14px;color:#374151;line-height:2.2;padding-left:20px;margin:0 0 24px;">
        <li>✅ Unlimited lesson note generation</li>
        <li>✅ Result compiler for any class size</li>
        <li>✅ 30+ report card comments at once</li>
        <li>✅ Full term scheme of work in seconds</li>
        <li>✅ Differentiated question sets</li>
        <li>✅ Reading comprehension builder</li>
      </ul>
      <div style="text-align:center;margin-bottom:24px;">
        <p style="font-size:14px;color:#6B7280;margin:0 0 16px;">
          <strong style="font-size:24px;color:#059669;">₦1,500/week</strong>
          &nbsp;or&nbsp;
          <strong style="font-size:24px;color:#059669;">₦3,500/month</strong>
        </p>
        <a href="${getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app'}/teacher/upgrade"
          style="display:inline-block;background:linear-gradient(135deg,#059669,#0891B2);color:white;font-size:16px;font-weight:800;padding:16px 40px;border-radius:12px;text-decoration:none;">
          Upgrade Teacher Plan →
        </a>
      </div>
      <p style="font-size:14px;color:#374151;">— The StudyHelp Team</p>
    </div>
    <div style="text-align:center;padding:20px;font-size:12px;color:#9CA3AF;">
      <p style="margin:0;">You're receiving this because you signed up with {{email}}.</p>
      <p style="margin:4px 0 0;">
        <a href="${getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app'}/unsubscribe?email={{email}}" style="color:#9CA3AF;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
`;
