import express from 'express';
import {
    getReminders,
    createReminder,
    updateReminder,
    deleteReminder,
    sendWhatsAppNotification
} from '../controllers/reminderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getReminders)
    .post(createReminder);

router.route('/:id')
    .patch(updateReminder)
    .delete(deleteReminder);

router.post('/whatsapp', sendWhatsAppNotification);
import User from '../models/User.js';
import { sendWhatsApp } from '../services/yCloudService.js';

router.get('/test-whatsapp', async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || (!user.phone && !user.phoneNumber)) {
            return res.json({ success: false, error: 'No valid phone number on account' });
        }

        const phone = user.phone || user.phoneNumber;
        const result = await sendWhatsApp(phone, '✅ StudyHelp WhatsApp test message! Your notifications are working.');

        if (result.success) {
            return res.json({ success: true, sid: result.messageId, method: result.method || 'WhatsApp' });
        }
        res.json({ success: false, error: result.error });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

export default router;
