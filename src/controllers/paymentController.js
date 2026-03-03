import axios from 'axios';
import crypto from 'crypto';
import { PLANS } from '../config/plans.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { getEnv } from '../config/env.js';

// POST /api/payment/initialize
export const initializePayment = async (req, res) => {
    try {
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

        // Save pending transaction
        await Transaction.create({
            userId,
            reference,
            amount: planConfig.price,
            plan,
            status: 'pending',
            processed: false
        });

        const secretKey = getEnv('PAYSTACK_SECRET_KEY');
        const frontendUrl = getEnv('FRONTEND_URL');

        // Call Paystack
        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.email,
                amount: planConfig.price,
                reference,
                metadata: {
                    userId: userId.toString(),
                    plan,
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
            reference,
            amount: planConfig.price,
            plan: planConfig.label
        });

    } catch (err) {
        console.error('Payment init error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
};

// POST /api/payment/verify
export const verifyPayment = async (req, res) => {
    try {
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({ error: 'Reference is required' });
        }

        // Check transaction exists
        const transaction = await Transaction.findOne({ reference });
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Prevent double processing
        if (transaction.processed) {
            return res.json({ success: true, message: 'Already activated', alreadyProcessed: true });
        }

        const secretKey = getEnv('PAYSTACK_SECRET_KEY');

        // Verify with Paystack
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${secretKey}` }
            }
        );

        const { status, amount } = response.data.data;

        if (status !== 'success') {
            await Transaction.findOneAndUpdate({ reference }, { status: 'failed' });
            return res.status(400).json({ error: 'Payment was not successful' });
        }

        // Verify amount matches plan (prevent tampering)
        const planConfig = PLANS[transaction.plan];
        if (amount !== planConfig.price) {
            console.error(`Amount mismatch: expected ${planConfig.price}, got ${amount}`);
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
        console.error('Payment verify error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};

// POST /api/payment/webhook
export const handleWebhook = async (req, res) => {
    try {
        const secretKey = getEnv('PAYSTACK_SECRET_KEY');

        // Verify Paystack signature
        const hash = crypto
            .createHmac('sha512', secretKey)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.status(401).send('Invalid signature');
        }

        const { event, data } = req.body;

        if (event === 'charge.success') {
            const { reference, amount } = data;

            const transaction = await Transaction.findOne({ reference });
            if (!transaction || transaction.processed) {
                return res.sendStatus(200); // already handled
            }

            // Verify amount
            const planConfig = PLANS[transaction.plan];
            if (amount !== planConfig.price) {
                console.error(`Webhook amount mismatch for ref: ${reference}`);
                return res.sendStatus(200);
            }

            await activateSubscription(transaction.userId, transaction.plan, reference);
            console.log(`✅ Webhook activated: ${transaction.plan} for user ${transaction.userId}`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Webhook error:', err.message);
        res.sendStatus(500);
    }
};

// GET /api/payment/status
export const getPaymentStatus = async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit flashcardUsageCount flashcardUsageLimit');

    const daysLeft = user.subscriptionEnd
        ? Math.max(0, Math.ceil((new Date(user.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24)))
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
    const planConfig = PLANS[plan];
    const now = new Date();

    const user = await User.findById(userId);

    let updateFields = {};

    if (plan === 'addon') {
        // Add-on: just add AI credits, don't change subscription dates
        updateFields = {
            $inc: { aiUsageLimit: planConfig.aiLimit }
        };
    } else {
        // Weekly or Monthly plan
        const isAlreadyActive =
            user.subscriptionStatus === 'active' &&
            user.subscriptionEnd &&
            new Date(user.subscriptionEnd) > now;

        // Never reset existing time — stack on top
        const startFrom = isAlreadyActive ? new Date(user.subscriptionEnd) : now;
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

    await User.findByIdAndUpdate(userId, updateFields);

    // Mark transaction as processed
    await Transaction.findOneAndUpdate(
        { reference },
        { status: 'success', processed: true }
    );

    console.log(`✅ Subscription activated: ${plan} for user ${userId}`);
};
