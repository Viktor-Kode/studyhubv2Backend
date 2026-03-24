import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    initializePayment,
    verifyPayment,
    handleWebhook,
    getPaymentStatus
} from '../controllers/paymentController.js';

const router = express.Router();

// Webhook: Flutterwave calls this directly (raw body is configured at app level)
router.post('/webhook', handleWebhook);

router.post('/initialize', protect, initializePayment);
// No JWT: users often return from Flutterwave with an expired token; verification is
// secured by Flutterwave verify(tx_ref + transaction_id) matching our pending row.
router.post('/verify', verifyPayment);
router.get('/status', protect, getPaymentStatus);

export default router;
