import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import { sendWhatsApp } from '../services/yCloudService.js';

const router = express.Router();

router.use(protect);

// GET /api/notifications/test
router.get('/test', async (req, res) => {
    try {
        const user = await User.findById(req.user.id || req.user._id);

        const phone = user?.phoneNumber || user?.phone;
        if (!phone) {
            return res.json({
                success: false,
                error: 'No phone number on your account. Add one in Settings.'
            });
        }

        const result = await sendWhatsApp(
            phone,
            `✅ *StudyHelp Test Message*\n\nYour WhatsApp notifications are working!\n_StudyHelp 🎓_`
        );

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
