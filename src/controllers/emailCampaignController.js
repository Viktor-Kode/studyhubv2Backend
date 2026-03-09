import User from '../models/User.js';
import { getEnv } from '../config/env.js';
import {
    sendBulkEmail,
    upgradeEmailTemplate,
    teacherUpgradeEmailTemplate
} from '../services/emailService.js';

const baseQuery = { emailUnsubscribed: { $ne: true } };

export const sendEmailCampaign = async (req, res) => {
    try {
        const {
            campaignType,
            subject,
            customHtml,
            targetAudience,
            testMode,
            testEmail
        } = req.body;

        console.log('[Campaign] Starting:', campaignType, '| Target:', targetAudience);

        let query = { ...baseQuery, role: { $ne: 'admin' } };

        if (targetAudience === 'free_students') {
            query.role = 'student';
            query.$or = [
                { subscriptionStatus: { $ne: 'active' } },
                { subscriptionStatus: null }
            ];
        } else if (targetAudience === 'free_teachers') {
            query.role = 'teacher';
            query.$or = [
                { teacherPlan: 'free' },
                { teacherPlan: null }
            ];
        } else if (targetAudience === 'all_free') {
            query = {
                ...baseQuery,
                role: { $ne: 'admin' },
                $or: [
                    { role: { $ne: 'teacher' }, $or: [{ subscriptionStatus: { $ne: 'active' } }, { subscriptionStatus: null }] },
                    { role: 'teacher', $or: [{ teacherPlan: 'free' }, { teacherPlan: null }] }
                ]
            };
        } else if (targetAudience === 'all_users') {
            query = { ...baseQuery, role: { $ne: 'admin' } };
        }

        let recipients = await User.find(query).select('name email').lean();

        console.log('[Campaign] Recipients found:', recipients.length);

        if (recipients.length === 0) {
            return res.status(400).json({ error: 'No recipients found for this audience' });
        }

        if (testMode) {
            const adminEmail = req.user?.email || testEmail;
            if (!adminEmail) {
                return res.status(400).json({ error: 'Test mode requires test email or logged-in admin' });
            }
            recipients = [{ name: 'Test User', email: adminEmail }];
            console.log('[Campaign] TEST MODE — sending to:', recipients[0].email);
        }

        let html = '';
        let emailSubject = subject;

        if (campaignType === 'upgrade_students') {
            html = upgradeEmailTemplate();
            emailSubject = subject || "You're missing out — upgrade your StudyHelp plan 🚀";
        } else if (campaignType === 'upgrade_teachers') {
            html = teacherUpgradeEmailTemplate();
            emailSubject = subject || "Unlock all Teacher Tools on StudyHelp 📚";
        } else if (campaignType === 'custom') {
            html = customHtml;
            emailSubject = subject;
        }

        if (!html || !emailSubject) {
            return res.status(400).json({ error: 'Email content and subject are required' });
        }

        const results = await sendBulkEmail(recipients, emailSubject, html);

        console.log('[Campaign] Complete:', results);

        res.json({
            success: true,
            results,
            message: `Campaign sent: ${results.sent} delivered, ${results.failed} failed`
        });
    } catch (err) {
        console.error('[Campaign] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

export const getEmailAudienceStats = async (req, res) => {
    try {
        const [totalUsers, freeStudents, freeTeachers, allFree] = await Promise.all([
            User.countDocuments({ ...baseQuery, role: { $ne: 'admin' } }),
            User.countDocuments({
                ...baseQuery,
                role: 'student',
                $or: [{ subscriptionStatus: { $ne: 'active' } }, { subscriptionStatus: null }]
            }),
            User.countDocuments({
                ...baseQuery,
                role: 'teacher',
                $or: [{ teacherPlan: 'free' }, { teacherPlan: null }]
            }),
            User.countDocuments({
                ...baseQuery,
                role: { $ne: 'admin' },
                $or: [
                    { role: { $ne: 'teacher' }, $or: [{ subscriptionStatus: { $ne: 'active' } }, { subscriptionStatus: null }] },
                    { role: 'teacher', $or: [{ teacherPlan: 'free' }, { teacherPlan: null }] }
                ]
            })
        ]);

        const paidStudents = await User.countDocuments({ subscriptionStatus: 'active' });

        res.json({
            success: true,
            audiences: {
                free_students: { count: freeStudents, label: 'Free Students' },
                free_teachers: { count: freeTeachers, label: 'Free Teachers' },
                all_free: { count: allFree, label: 'All Free Users' },
                all_users: { count: totalUsers, label: 'All Users' },
                paid_students: { count: paidStudents, label: 'Paid Students' }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const unsubscribe = async (req, res) => {
    try {
        const { email } = req.query;
        const frontendUrl = getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app';
        if (!email) {
            if (req.get('Accept')?.includes('application/json')) {
                return res.status(400).json({ success: false, error: 'missing' });
            }
            return res.redirect(`${frontendUrl}/unsubscribed?error=missing`);
        }
        await User.findOneAndUpdate(
            { email: String(email).toLowerCase().trim() },
            { $set: { emailUnsubscribed: true } }
        );
        if (req.get('Accept')?.includes('application/json')) {
            return res.json({ success: true });
        }
        res.redirect(`${frontendUrl}/unsubscribed`);
    } catch (err) {
        console.error('[Unsubscribe]', err);
        const frontendUrl = getEnv('FRONTEND_URL') || 'https://studyhubv2-self.vercel.app';
        if (req.get('Accept')?.includes('application/json')) {
            return res.status(500).json({ success: false });
        }
        res.redirect(`${frontendUrl}/unsubscribed?error=1`);
    }
};
