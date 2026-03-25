import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  getGroups,
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  generateInvite,
  joinGroup,
  addGroupMember,
  updateMemberRole,
  removeGroupMember,
  getGroupPosts,
  createGroupPost,
  likeGroupPost,
  getGroupPostComments,
  addGroupPostComment,
  getGroupResources,
  uploadGroupResource,
  getGroupChat,
  sendGroupChatMessage,
  getGroupSessions,
  createGroupSession,
  rsvpGroupSession,
  getGroupTodos,
  createGroupTodo,
  updateGroupTodo,
} from '../controllers/groupsController.js';

const router = express.Router();
router.use(protect);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file?.mimetype) return cb(new Error('Unsupported file type'));
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    if (file.mimetype === 'application/pdf') return cb(null, true);
    return cb(new Error('Only images and PDFs are allowed'));
  },
});

// GROUPS
router.get('/', getGroups);
router.post('/', createGroup);
router.get('/:id', getGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);
router.post('/:id/invite', generateInvite);
router.post('/:id/join', joinGroup);

// MEMBERS
router.post('/:id/members', addGroupMember);
router.put('/:id/members/:userId', updateMemberRole);
router.delete('/:id/members/:userId', removeGroupMember);

// POSTS (feed + comments)
router.get('/:id/posts', getGroupPosts);
router.post('/:id/posts', createGroupPost);
router.post('/:id/posts/:postId/like', likeGroupPost);
router.get('/:id/posts/:postId/comments', getGroupPostComments);
router.post('/:id/posts/:postId/comments', addGroupPostComment);

// RESOURCES
router.get('/:id/resources', getGroupResources);
router.post('/:id/resources', upload.single('file'), uploadGroupResource);

// CHAT
router.get('/:id/chat', getGroupChat);
router.post('/:id/chat', sendGroupChatMessage);

// STUDY SESSIONS
router.get('/:id/sessions', getGroupSessions);
router.post('/:id/sessions', createGroupSession);
router.post('/:id/sessions/:sessionId/rsvp', rsvpGroupSession);

// TODOS
router.get('/:id/todos', getGroupTodos);
router.post('/:id/todos', createGroupTodo);
router.put('/:id/todos/:todoId', updateGroupTodo);

export default router;

