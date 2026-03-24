import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  getPosts,
  getCommunityProfile,
  getLikedPosts,
  getBookmarkedPosts,
  createPost,
  likePost,
  deletePost,
  updatePost,
  getComments,
  addComment,
  votePoll,
  markBestAnswer,
  toggleBookmark,
  reportPost,
  pinPost,
  getTrending,
  getCommunityMe,
  getCommunityStats,
  getNotifications,
  markNotificationRead,
  communitySearch,
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
router.get('/profile', protect, getCommunityProfile);
router.get('/me', protect, getCommunityMe);
router.get('/stats', protect, getCommunityStats);
router.get('/trending', protect, getTrending);
router.get('/search', protect, communitySearch);
router.get('/notifications', protect, getNotifications);
router.put('/notifications/:id/read', protect, markNotificationRead);
router.get('/liked-posts', protect, getLikedPosts);
router.get('/bookmarks', protect, getBookmarkedPosts);
router.get('/posts', protect, getPosts);
router.post('/posts', protect, createPost);
router.post('/posts/:id/like', protect, likePost);
router.post('/posts/:id/bookmark', protect, toggleBookmark);
router.post('/posts/:id/best-answer', protect, markBestAnswer);
router.post('/posts/:id/report', protect, reportPost);
router.post('/posts/:id/pin', protect, pinPost);
router.delete('/posts/:id', protect, deletePost);
router.patch('/posts/:id', protect, updatePost);
router.put('/posts/:id', protect, updatePost);

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

