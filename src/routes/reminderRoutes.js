import express from 'express';
import {
    getReminders,
    createReminder,
    updateReminder,
    deleteReminder,
    sendWhatsApp
} from '../controllers/reminderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getReminders);
router.post('/', createReminder);
router.post('/whatsapp', sendWhatsApp);
router.put('/:id', updateReminder);
router.delete('/:id', deleteReminder);

export default router;

