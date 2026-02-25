import express from 'express';
import { initializePayment, verifyPayment, handleWebhook } from '../controllers/paymentController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/initialize', protect, initializePayment);
router.get('/verify/:reference', protect, verifyPayment);
router.post('/webhook', handleWebhook);

export default router;
