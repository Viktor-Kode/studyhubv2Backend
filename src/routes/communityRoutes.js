import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  getPosts,
  createPost,
  likePost,
  deletePost,
  getComments,
  addComment,
  votePoll,
  getLeaderboard,
  uploadCommunityImage,
} from '../controllers/communityController.js';

const router = express.Router();

// Image upload (Cloudinary): max 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file?.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// POSTS
router.get('/posts', protect, getPosts);
router.post('/posts', protect, createPost);
router.post('/posts/:id/like', protect, likePost);
router.delete('/posts/:id', protect, deletePost);

// COMMENTS
router.get('/posts/:id/comments', protect, getComments);
router.post('/posts/:id/comments', protect, addComment);

// POLLS
router.post('/posts/:id/vote', protect, votePoll);

// LEADERBOARD
router.get('/leaderboard', protect, getLeaderboard);

// IMAGE UPLOAD
router.post('/upload-image', protect, upload.single('image'), uploadCommunityImage);

export default router;

