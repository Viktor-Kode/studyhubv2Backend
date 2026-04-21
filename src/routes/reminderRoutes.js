import express from 'express';
import {
    getReminders,
    createReminder,
    updateReminder,
    deleteReminder,
} from '../controllers/reminderController.js';
import { protect } from '../middleware/authMiddleware.js';

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


export default router;

