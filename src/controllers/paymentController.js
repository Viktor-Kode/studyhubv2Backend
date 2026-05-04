import axios from 'axios';
import Flutterwave from 'flutterwave-node-v3';
import { PLANS } from '../config/plans.js';
import User from '../models/User.js';
import { sendNotification } from '../services/notificationService.js';
import Transaction from '../models/Transaction.js';
import { getEnv } from '../config/env.js';
import { expireStaleActiveSubscription } from '../utils/studentSubscription.js';

/**
 * Compare Flutterwave "amount" to our plan (NGN).
 * Some responses use kobo/minor units — normalize when an order of magnitude off.
 */
function isChargedAmountAcceptable(chargedRaw, expectedNaira) {
    let charged = Number(chargedRaw);
    const expected = Number(expectedNaira);
    if (!Number.isFinite(charged) || !Number.isFinite(expected)) return false;
    if (expected > 0 && charged > expected * 50) {
        charged /= 100;
    }
    const slack = 2; // ₦2 max — rounding / fees, not a discount loophole
    return charged + 1e-6 >= expected - slack;
}

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

        // Save pending transaction (amount in naira for Flutterwave)
        const amountNaira = planConfig.amount ?? planConfig.price / 100;
        await Transaction.create({
            userId,
            reference,
            amount: amountNaira,
            plan,
            status: 'pending',
            processed: false
        });

        // Determine frontend URL (production-safe default)
        const frontendUrl = getEnv('FRONTEND_URL', 'https://studyhubv2-self.vercel.app');

        // Flutterwave payment payload (amount in naira)
        const payload = {
            tx_ref: reference,
            amount: amountNaira,
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
                logo: `${frontendUrl}/icons/icon-192x192.png`
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
            amount: amountNaira,
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

        if (!transaction_id) {
            return res.status(400).json({ error: 'transaction_id is required' });
        }

        const transaction = await Transaction.findOne({ reference });
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

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

        const envelope = await flw.Transaction.verify({ id: transaction_id });
        if (envelope.status !== 'success' || !envelope.data) {
            await Transaction.findOneAndUpdate({ reference }, { $set: { status: 'failed' } });
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        const data = envelope.data;

        if (
            data.status !== 'successful' ||
            String(data.tx_ref || '') !== String(reference) ||
            data.currency !== 'NGN'
        ) {
            await Transaction.findOneAndUpdate({ reference }, { $set: { status: 'failed' } });
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        const planConfig = PLANS[transaction.plan];
        const expectedAmount = planConfig.amount ?? planConfig.price / 100;
        const charged = data.amount ?? data.charged_amount ?? data.amount_settled;
        if (!isChargedAmountAcceptable(charged, expectedAmount)) {
            console.error(`Amount mismatch: expected ~${expectedAmount}, got ${charged} ref=${reference}`);
            return res.status(400).json({ error: 'Payment amount mismatch' });
        }

        const claimed = await Transaction.findOneAndUpdate(
            { reference, processed: false },
            { $set: { processed: true, status: 'success', processedAt: new Date() } },
            { new: true }
        );

        if (!claimed) {
            return res.json({
                success: true,
                message: 'Already activated',
                alreadyProcessed: true
            });
        }

        // Note: Subscription is NOT applied here. It is handled by the webhook for security.
        // This endpoint just verifies the status for the UI.

        res.json({
            success: true,
            status: claimed.status,
            message: 'Payment verification initiated. Your plan will be updated shortly.',
            plan: claimed.plan
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

            const planConfig = PLANS[transaction.plan];
            const expectedAmount = planConfig.amount ?? planConfig.price / 100;
            const charged = data.amount ?? data.charged_amount ?? data.amount_settled;
            if (!isChargedAmountAcceptable(charged, expectedAmount)) {
                console.error(`Webhook amount mismatch: ${reference} charged=${charged} expected=${expectedAmount}`);
                return res.sendStatus(200);
            }

            const claimed = await Transaction.findOneAndUpdate(
                { reference, processed: false },
                { $set: { processed: true, status: 'success', processedAt: new Date() } },
                { new: true }
            );

            if (!claimed) {
                return res.sendStatus(200);
            }

            try {
                await applySubscriptionToUser(claimed.userId, claimed.plan);
                console.log(`✅ Webhook activated: ${claimed.plan} for user ${claimed.userId}`);
            } catch (e) {
                console.error('❌ Webhook activation failed:', e.message);
                await Transaction.findOneAndUpdate(
                    { reference },
                    { $set: { processed: false, status: 'pending', processedAt: null } }
                );
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('❌ Webhook error:', err.message);
        res.sendStatus(200); // Always 200 so Flutterwave doesn't retry
    }
};

// GET /api/payment/status
export const getPaymentStatus = async (req, res) => {
    let user = await User.findById(req.user.id)
        .select('subscriptionStatus subscriptionPlan subscriptionEnd aiUsageCount aiUsageLimit flashcardUsageCount flashcardUsageLimit');

    user = await expireStaleActiveSubscription(user);

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

// ─── Apply plan to user (transaction row already claimed) ───────────────────
const applySubscriptionToUser = async (userId, plan) => {
    const planConfig = PLANS[plan];
    if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

    const now = new Date();
    const user = await User.findById(userId);
    if (!user) throw new Error(`User not found: ${userId}`);

    if (plan === 'addon') {
        await User.findByIdAndUpdate(userId, {
            $inc: { aiUsageLimit: planConfig.aiLimit }
        });
        console.log(`[Activation] ✅ Add-on: +${planConfig.aiLimit} AI credits for user ${userId}`);
        return User.findById(userId);
    }

    const isAlreadyActive =
        user.subscriptionStatus === 'active' &&
        user.subscriptionEnd &&
        new Date(user.subscriptionEnd) > now;

    const startFrom = isAlreadyActive ? new Date(user.subscriptionEnd) : now;
    const newEnd = new Date(startFrom);
    newEnd.setDate(newEnd.getDate() + planConfig.durationDays);

    await User.findByIdAndUpdate(userId, {
        $set: {
            subscriptionStatus: 'active',
            subscriptionPlan: plan,
            subscriptionStart: isAlreadyActive ? user.subscriptionStart : now,
            subscriptionEnd: newEnd,
            aiUsageCount: 0,
            aiUsageLimit: planConfig.aiLimit,
            flashcardUsageCount: 0,
            flashcardUsageLimit: planConfig.flashcardLimit
        }
    });

    console.log(`[Activation] ✅ ${plan} until ${newEnd.toISOString()} user=${userId}`);

    const updated = await User.findById(userId);
    const planLabel = planConfig?.label || plan;
    const expiryStr = newEnd.toLocaleDateString('en-NG');
    if (updated?.firebaseUid) {
        void sendNotification({
            userId: updated.firebaseUid,
            type: 'payment_confirmed',
            title: 'Payment Confirmed! 🎉',
            body: `Your ${planLabel} plan is now active.`,
            icon: '✅',
            link: '/dashboard/student',
            data: { plan: planLabel, expiryDate: expiryStr },
        });
    }

    return updated;
};
