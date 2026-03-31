import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createGroup,
    joinGroup,
    leaveGroup,
    startGroupSession,
    getGroupStatus,
    submitGroupCBT,
    listMyGroupCBTs,
} from '../controllers/groupCBTController.js';

const router = express.Router();
router.use(protect);

router.get('/', listMyGroupCBTs);
router.post('/', createGroup);
router.post('/join', joinGroup);
router.get('/:id', getGroupStatus);
router.post('/:id/start', startGroupSession);
router.post('/:id/submit', submitGroupCBT);
router.post('/:id/leave', leaveGroup);

export default router;
