import axios from 'axios';
import Flutterwave from 'flutterwave-node-v3';
import crypto from 'crypto';
import { PLANS } from '../config/plans.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { getEnv } from '../config/env.js';

// Lazy init: only create Flutterwave instance when keys exist (avoids CI crash on load)
let flw = null;
if (process.env.FLW_PUBLIC_KEY && process.env.FLW_SECRET_KEY) {
    flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);
}

// POST /api/payment/initialize
export const initializePayment = async (req, res) => {
    try {
        if (!process.env.FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY) {
            return res.status(503).json({ error: 'Payment service not configured' });
        }
        const { plan } = req.body;
        const userId = req.user.id;

        if (!PLANS[plan] || plan === 'free') {
            return res.status(400).json({ error: 'Invalid plan selected' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const planConfig = PLANS[plan];

        // Generate unique reference
        const reference = `SH-${userId.toString().slice(-6)}-${Date.now()}`;

        // Save pending transaction (amount stored in naira for Flutterwave)
        await Transaction.create({
            userId,
            reference,
            amount: planConfig.price / 100,
            plan,
            status: 'pending',
            processed: false
        });

        // Determine frontend URL (production-safe default)
        const frontendUrl = getEnv('FRONTEND_URL', 'https://studyhubv2-self.vercel.app');

        // Flutterwave payment payload
        const payload = {
            tx_ref: reference,
            amount: planConfig.price / 100,
            currency: 'NGN',
            redirect_url: `${frontendUrl}/payment/verify`,
            customer: {
                email: user.email,
                name: user.name,
                phonenumber: user.phoneNumber || ''
            },
            customizations: {
                title: 'StudyHelp',
                description: `${planConfig.label} Subscription`,
                logo: `${process.env.FRONTEND_URL}/logo.png`
            },
            meta: {
                userId: userId.toString(),
                plan
            }
        };

        // Use Flutterwave REST API to create a hosted payment
        const response = await axios.post(
            'https://api.flutterwave.com/v3/payments',
            payload,
            {
                headers: {
                    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.status !== 'success') {
            throw new Error(response.data.message || 'Payment initialization failed');
        }

        res.json({
            success: true,
            authorizationUrl: response.data.data.link,
            reference,
            amount: planConfig.price / 100,
            plan: planConfig.label
        });

    } catch (err) {
        console.error('❌ Payment init error:', err.message);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
};

// POST /api/payment/verify
export const verifyPayment = async (req, res) => {
    try {
        const { transaction_id, tx_ref } = req.body;
        const reference = tx_ref;

        if (!reference) {
            return res.status(400).json({ error: 'Reference is required' });
        }

        const transaction = await Transaction.findOne({ reference });
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Prevent double processing
        if (transaction.processed) {
            return res.json({
                success: true,
                message: 'Already activated',
                alreadyProcessed: true
            });
        }

        if (!flw) {
            return res.status(503).json({ error: 'Payment service not configured' });
        }

        // Verify with Flutterwave using transaction_id
        const response = await flw.Transaction.verify({ id: transaction_id });

        if (
            response.data.status !== 'successful' ||
            response.data.tx_ref !== reference ||
            response.data.currency !== 'NGN'
        ) {
            await Transaction.findOneAndUpdate({ reference }, { status: 'failed' });
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        // Verify amount matches plan (prevent tampering)
        const planConfig = PLANS[transaction.plan];
        const expectedAmount = planConfig.price / 100;
        if (response.data.amount < expectedAmount) {
            console.error(`Amount mismatch: expected ${expectedAmount}, got ${response.data.amount}`);
            return res.status(400).json({ error: 'Payment amount mismatch' });
        }

        // Activate subscription
        await activateSubscription(transaction.userId, transaction.plan, reference);

        res.json({
            success: true,
            message: `${planConfig.label} activated successfully!`,
            plan: transaction.plan
        });

    } catch (err) {
        console.error('❌ Payment verify error:', err.message);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};

// POST /api/payment/webhook
export const handleWebhook = async (req, res) => {
    try {
        // Verify Flutterwave webhook signature
        const secretHash = process.env.FLW_SECRET_HASH;
        const signature = req.headers['verif-hash'];

        if (!signature || signature !== secretHash) {
            return res.status(401).send('Invalid signature');
        }

        const rawBody = req.body;
        const body = Buffer.isBuffer(rawBody) || typeof rawBody === 'string'
            ? JSON.parse(rawBody.toString())
            : rawBody;

        const { event, data } = body;

        if (event === 'charge.completed' && data.status === 'successful') {
            const reference = data.tx_ref;

            const transaction = await Transaction.findOne({ reference });
            if (!transaction || transaction.processed) {
                return res.sendStatus(200);
            }

            // Verify amount
            const planConfig = PLANS[transaction.plan];
            const expectedAmount = planConfig.price / 100;
            if (data.amount < expectedAmount) {
                console.error(`Webhook amount mismatch: ${reference}`);
                return res.sendStatus(200);
            }

            await activateSubscription(transaction.userId, transaction.plan, reference);
            console.log(`✅ Webhook activated: ${transaction.plan} for user ${transaction.userId}`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('❌ Webhook error:', err.message);
        res.sendStatus(500);
    }
};

// GET /api/payment/status
export const getPaymentStatus = async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit flashcardUsageCount flashcardUsageLimit');

    const daysLeft = user.subscriptionEnd
        ? Math.max(0, Math.ceil(
            (new Date(user.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24)
        ))
        : 0;

    res.json({
        success: true,
        subscription: {
            status: user.subscriptionStatus,
            plan: user.subscriptionPlan,
            daysLeft,
            expiresAt: user.subscriptionEnd
        },
        usage: {
            ai: { used: user.aiUsageCount, limit: user.aiUsageLimit },
            flashcards: { used: user.flashcardUsageCount, limit: user.flashcardUsageLimit }
        }
    });
};

// ─── Shared Activation Function ───────────────────────────────
const activateSubscription = async (userId, plan, reference) => {
    try {
        console.log(`🔄 Activating subscription: plan=${plan} userId=${userId}`);

        const planConfig = PLANS[plan];
        if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

        const now = new Date();
        const user = await User.findById(userId);

        if (!user) throw new Error(`User not found: ${userId}`);

        console.log('📋 User before activation:', {
            status: user.subscriptionStatus,
            plan: user.subscriptionPlan,
            end: user.subscriptionEnd
        });

        let updateFields = {};

        if (plan === 'addon') {
            updateFields = {
                $inc: { aiUsageLimit: planConfig.aiLimit }
            };
        } else {
            const isAlreadyActive =
                user.subscriptionStatus === 'active' &&
                user.subscriptionEnd &&
                new Date(user.subscriptionEnd) > now;

            const startFrom = isAlreadyActive
                ? new Date(user.subscriptionEnd)
                : now;

            const newEnd = new Date(startFrom);
            newEnd.setDate(newEnd.getDate() + planConfig.durationDays);

            updateFields = {
                subscriptionStatus: 'active',
                subscriptionPlan: plan,
                subscriptionStart: isAlreadyActive ? user.subscriptionStart : now,
                subscriptionEnd: newEnd,
                aiUsageCount: 0,
                aiUsageLimit: planConfig.aiLimit,
                flashcardUsageCount: 0,
                flashcardUsageLimit: planConfig.flashcardLimit
            };
        }

        const updated = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true }
        );

        console.log('✅ User after activation:', {
            status: updated.subscriptionStatus,
            plan: updated.subscriptionPlan,
            end: updated.subscriptionEnd,
            aiLimit: updated.aiUsageLimit
        });

        await Transaction.findOneAndUpdate(
            { reference },
            { $set: { status: 'success', processed: true } }
        );

        console.log(`✅ Transaction marked processed: ${reference}`);
        return updated;
    } catch (err) {
        console.error('❌ activateSubscription error:', err.message);
        throw err;
    }
};
