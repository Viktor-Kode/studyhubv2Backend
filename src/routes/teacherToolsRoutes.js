import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { checkTeacherUsage } from '../middleware/teacherUsageMiddleware.js';
import { checkAIUsage } from '../middleware/usageMiddleware.js';
import {
    getTeacherUsage,
    generateLessonNote,
    compileResults,
    generateReportComments,
    generateReportComment,
    generateSchemeOfWork,
    generateMarkingScheme,
    generateDifferentiated,
    generateComprehension,
    generateDiaryEntries,
    listSaved,
    getSaved,
    saveItem,
    deleteSaved
} from '../controllers/teacherToolsController.js';

const router = express.Router();
router.use(protect);

router.get('/usage', getTeacherUsage);
router.post('/lesson-note', checkAIUsage, checkTeacherUsage('lesson_note'), generateLessonNote);
router.post('/compile-results', checkTeacherUsage('result_compiler'), compileResults);
router.post('/report-comments', checkAIUsage, checkTeacherUsage('report_card'), generateReportComments);
router.post('/scheme-of-work', checkAIUsage, checkTeacherUsage('scheme_of_work'), generateSchemeOfWork);
router.post('/marking-scheme', checkAIUsage, checkTeacherUsage('marking_scheme'), generateMarkingScheme);
router.post('/differentiated', checkAIUsage, checkTeacherUsage('differentiated'), generateDifferentiated);
router.post('/comprehension', checkAIUsage, checkTeacherUsage('comprehension'), generateComprehension);
router.post('/diary', checkAIUsage, checkTeacherUsage('diary'), generateDiaryEntries);
router.post('/report-comment', checkAIUsage, checkTeacherUsage('report_comment'), generateReportComment);

router.get('/saved', listSaved);
router.get('/saved/:type/:id', getSaved);
router.post('/saved', saveItem);
router.delete('/saved/:type/:id', deleteSaved);

export default router;
