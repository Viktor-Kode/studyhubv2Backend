import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  getPosts,
  createPost,
  likePost,
  deletePost,
  updatePost,
  getComments,
  addComment,
  votePoll,
  getLeaderboard,
  uploadCommunityImage,
  searchUsers,
  getGroups,
  createGroup,
  addGroupMember,
  getGroupMessages,
  sendGroupMessage,
} from '../controllers/communityController.js';

const router = express.Router();

// Image upload (Cloudinary). Keep ≤4MB so requests proxied via Vercel (≈4.5MB body limit) succeed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
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
router.patch('/posts/:id', protect, updatePost);

// COMMENTS
router.get('/posts/:id/comments', protect, getComments);
router.post('/posts/:id/comments', protect, addComment);

// POLLS
router.post('/posts/:id/vote', protect, votePoll);

// LEADERBOARD
router.get('/leaderboard', protect, getLeaderboard);

// GROUPS
router.get('/users/search', protect, searchUsers);
router.get('/groups', protect, getGroups);
router.post('/groups', protect, createGroup);
router.post('/groups/:id/members', protect, addGroupMember);
router.get('/groups/:id/messages', protect, getGroupMessages);
router.post('/groups/:id/messages', protect, sendGroupMessage);

// IMAGE UPLOAD
router.post('/upload-image', protect, upload.single('image'), uploadCommunityImage);

export default router;

