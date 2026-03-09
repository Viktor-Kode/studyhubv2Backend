import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { checkTeacherUsage } from '../middleware/teacherUsageMiddleware.js';
import {
    getTeacherUsage,
    generateLessonNote,
    compileResults,
    generateReportComments,
    generateSchemeOfWork,
    generateMarkingScheme,
    generateDifferentiated,
    generateComprehension
} from '../controllers/teacherToolsController.js';

const router = express.Router();
router.use(protect);

router.get('/usage', getTeacherUsage);
router.post('/lesson-note', checkTeacherUsage('lesson_note'), generateLessonNote);
router.post('/compile-results', checkTeacherUsage('result_compiler'), compileResults);
router.post('/report-comments', checkTeacherUsage('report_card'), generateReportComments);
router.post('/scheme-of-work', checkTeacherUsage('scheme_of_work'), generateSchemeOfWork);
router.post('/marking-scheme', checkTeacherUsage('marking_scheme'), generateMarkingScheme);
router.post('/differentiated', checkTeacherUsage('differentiated'), generateDifferentiated);
router.post('/comprehension', checkTeacherUsage('comprehension'), generateComprehension);

export default router;
