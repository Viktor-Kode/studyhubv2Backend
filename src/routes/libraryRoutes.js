import express from 'express';
import {
    getGuides,
    getGuide,
    getSubjects,
    getRecommendedGuides,
    guideAccessControl,
    getAdminGuides,
    createGuide,
    updateGuide,
    validateGuide,
    deleteGuide,
    generateStudyGuide,
    seedStarterGuides,
    validateAllGuides
} from '../controllers/libraryController.js';
import { protect, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// ---- PUBLIC / STUDENT ROUTES ----
// Order matters: specific routes before parameter routes
router.get('/library/guides', getGuides);
router.get('/library/guides/subjects', getSubjects);
router.get('/library/guides/recommended', protect, getRecommendedGuides);
router.get('/library/guides/:id', protect, guideAccessControl, getGuide);

// ---- ADMIN ONLY ROUTES ----
// Usually these would be namespaced like /api/admin/guides,
// but since the controller logic is here, we match the prompt paths
router.get('/admin/guides', protect, restrictTo('admin', 'teacher'), getAdminGuides);
router.post('/admin/guides', protect, restrictTo('admin', 'teacher'), createGuide);
router.post('/admin/guides/generate-ai', protect, restrictTo('admin', 'teacher'), generateStudyGuide);
router.put('/admin/guides/:id', protect, restrictTo('admin', 'teacher'), updateGuide);
router.put('/admin/guides/:id/validate', protect, restrictTo('admin', 'teacher'), validateGuide);
router.post('/admin/guides/seed-starter', protect, restrictTo('admin', 'teacher'), seedStarterGuides);
router.post('/admin/guides/validate-all', protect, restrictTo('admin', 'teacher'), validateAllGuides);
router.delete('/admin/guides/:id', protect, restrictTo('admin', 'teacher'), deleteGuide);

export default router;
