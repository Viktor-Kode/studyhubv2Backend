import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { uploadMiddleware } from '../config/multer.js';
import {
    generateQuestions,
    getQuestionSets,
    getQuestionSet,
    updateQuestionSet,
    deleteQuestionSet,
    getDownloadData
} from '../controllers/teacherController.js';

const router = express.Router();

router.use(protect);

router.post('/generate', uploadMiddleware.single('document'), generateQuestions);
router.get('/question-sets', getQuestionSets);
router.get('/question-sets/:id', getQuestionSet);
router.put('/question-sets/:id', updateQuestionSet);
router.delete('/question-sets/:id', deleteQuestionSet);
router.get('/question-sets/:id/download', getDownloadData);

export default router;
