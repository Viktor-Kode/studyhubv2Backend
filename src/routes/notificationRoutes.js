import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import { sendMessage, checkBalance } from '../services/termiiService.js';
import {
  getNotifications,
  markAllRead,
  markOneRead,
  registerToken,
  disableNotifications,
} from '../controllers/notificationController.js';

const router = express.Router();

router.use(protect);

router.get('/', getNotifications);
router.post('/mark-read', markAllRead);
router.post('/mark-read/:id', markOneRead);
router.post('/register-token', registerToken);
router.post('/disable', disableNotifications);

// GET /api/notifications/test — SMS test (Termii)
router.get('/test', async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id);

    const phone = user?.phoneNumber || user?.phone;
    if (!phone) {
      return res.json({
        success: false,
        error: 'No phone number on your account. Add one in Settings.',
      });
    }

    const balance = await checkBalance();

    const result = await sendMessage(
      phone,
      `StudyHelp Test Message\n\nYour notifications are working!\n\nstudyhelp.com`
    );

    res.json({
      success: result.success,
      channel: result.channel,
      balance,
      result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
