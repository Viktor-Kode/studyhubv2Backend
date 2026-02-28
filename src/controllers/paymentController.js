import axios from 'axios';
import crypto from 'crypto';
import User from '../models/User.js';
import { PLANS } from '../config/plans.js';
import { getEnv } from '../config/env.js';

export const initializePayment = async (req, res) => {
    const { planType } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);
    const plan = PLANS[planType];

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!plan || plan.price === 0) return res.status(400).json({ error: 'Invalid plan selected' });

    try {
        const secretKey = getEnv('PAYSTACK_SECRET_KEY');
        const frontendUrl = getEnv('FRONTEND_URL');

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.email,
                amount: plan.price,
                metadata: {
                    userId: user._id.toString(),
                    planType,
                    userName: user.name
                },
                callback_url: `${frontendUrl}/payment/verify`
            },
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            authorizationUrl: response.data.data.authorization_url,
            reference: response.data.data.reference,
            amount: plan.price
        });
    } catch (err) {
        console.error('[Payment Init] Error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
};

export const verifyPayment = async (req, res) => {
    const { reference } = req.params;

    try {
        const secretKey = getEnv('PAYSTACK_SECRET_KEY');
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`
                }
            }
        );

        const { status, metadata } = response.data.data;

        if (status !== 'success') {
            return res.status(400).json({ error: 'Payment not successful' });
        }

        const { userId, planType } = metadata;
        const plan = PLANS[planType];

        await User.findByIdAndUpdate(userId, {
            'plan.type': planType,
            'plan.testsAllowed': plan.testsAllowed,
            'plan.testsUsed': 0,
            'plan.aiExplanationsAllowed': plan.aiExplanationsAllowed,
            'plan.aiExplanationsUsed': 0,
            'plan.allSubjects': plan.allSubjects,
            'plan.subjectsAllowed': plan.subjectsAllowed,
            'plan.paystackReference': reference,
            'plan.expiresAt': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        res.json({ success: true, message: 'Plan upgraded successfully', plan: planType });
    } catch (err) {
        console.error('[Payment Verify] Error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};

export const handleWebhook = async (req, res) => {
    const secret = getEnv('PAYSTACK_SECRET_KEY');
    const hash = crypto
        .createHmac('sha512', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        return res.status(401).send('Invalid signature');
    }

    const { event, data } = req.body;

    if (event === 'charge.success') {
        const { metadata, reference } = data;
        const { userId, planType } = metadata;
        const plan = PLANS[planType];

        await User.findByIdAndUpdate(userId, {
            'plan.type': planType,
            'plan.testsAllowed': plan.testsAllowed,
            'plan.testsUsed': 0,
            'plan.aiExplanationsAllowed': plan.aiExplanationsAllowed,
            'plan.aiExplanationsUsed': 0,
            'plan.allSubjects': plan.allSubjects,
            'plan.subjectsAllowed': plan.subjectsAllowed,
            'plan.paystackReference': reference,
            'plan.expiresAt': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        console.log(`✅ Plan upgraded via Webhook for user ${userId} → ${planType}`);
    }

    res.sendStatus(200);
};
