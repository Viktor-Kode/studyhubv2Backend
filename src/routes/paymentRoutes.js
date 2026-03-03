import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    initializePayment,
    verifyPayment,
    handleWebhook,
    getPaymentStatus
} from '../controllers/paymentController.js';

const router = express.Router();

// Webhook: Paystack calls this directly (raw body is configured at app level)
router.post('/webhook', handleWebhook);

router.post('/initialize', protect, initializePayment);
router.post('/verify', protect, verifyPayment);
router.get('/status', protect, getPaymentStatus);

export default router;
