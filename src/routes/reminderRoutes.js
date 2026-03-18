import express from 'express';
import {
    getReminders,
    createReminder,
    updateReminder,
    deleteReminder,
    sendWhatsAppNotification,
    sendTwilioTimetableReminder,
} from '../controllers/reminderController.js';
import { protect } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import { sendWhatsAppText } from '../services/twilioService.js';

const router = express.Router();

router.use(protect);

router
    .route('/')
    .get(getReminders)
    .post(createReminder);

router
    .route('/:id')
    .patch(updateReminder)
    .delete(deleteReminder);

router.post('/whatsapp', sendWhatsAppNotification);

router.get('/test-whatsapp', async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || (!user.phone && !user.phoneNumber)) {
            return res.json({ success: false, error: 'No valid phone number on account' });
        }

        const phone = user.phone || user.phoneNumber;
        const result = await sendWhatsAppText({
            to: phone,
            body: 'StudyHelp test message! Your WhatsApp notifications are working via Twilio.',
        });

        if (result.success) {
            return res.json({
                success: true,
                sid: result.sid,
                method: 'whatsapp-twilio',
            });
        }
        res.json({ success: false, error: result.error });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/twilio-timetable', sendTwilioTimetableReminder);

export default router;

