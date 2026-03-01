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
    generateStudyGuide
} from '../controllers/libraryController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// ---- PUBLIC / STUDENT ROUTES ----
// Order matters: specific routes before parameter routes
router.get('/guides', getGuides);
router.get('/guides/subjects', getSubjects);
router.get('/guides/recommended', protect, getRecommendedGuides);
router.get('/guides/:id', protect, guideAccessControl, getGuide);

// ---- ADMIN ONLY ROUTES ----
// Usually these would be namespaced like /api/admin/guides,
// but since the controller logic is here, we match the prompt paths
router.get('/admin/guides', protect, authorize('admin', 'teacher'), getAdminGuides);
router.post('/admin/guides', protect, authorize('admin', 'teacher'), createGuide);
router.post('/admin/guides/generate-ai', protect, authorize('admin', 'teacher'), generateStudyGuide);
router.put('/admin/guides/:id', protect, authorize('admin', 'teacher'), updateGuide);
router.put('/admin/guides/:id/validate', protect, authorize('admin', 'teacher'), validateGuide);
router.delete('/admin/guides/:id', protect, authorize('admin', 'teacher'), deleteGuide);

export default router;
