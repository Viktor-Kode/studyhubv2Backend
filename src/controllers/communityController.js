import cloudinary from '../config/cloudinary.js';
import User from '../models/User.js';
import CommunityPost from '../models/CommunityPost.js';
import CommunityComment from '../models/CommunityComment.js';
import CommunityGroup from '../models/CommunityGroup.js';
import CommunityGroupMessage from '../models/CommunityGroupMessage.js';

function computeInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] || 'U';
  const second = words[1]?.[0] || '';
  return (first + second).toUpperCase();
}

function getFirebaseUid(reqUser) {
  // authMiddleware stores decoded Firebase UID here
  return reqUser?.firebaseUid || reqUser?.uid || reqUser?._id?.toString?.() || null;
}

async function recalcTotalPoints(user) {
  user.communityPoints = user.communityPoints || 0;
  user.cbtPoints = user.cbtPoints || 0;
  user.totalPoints = user.communityPoints + user.cbtPoints;
  await user.save({ validateBeforeSave: false });
  return user;
}

function normalizePostForClient(post, currentUserFirebaseUid, authorMeta = null) {
  const likes = post.likes || [];
  const likesCount = likes.length;
  const isLiked = !!currentUserFirebaseUid && likes.includes(currentUserFirebaseUid);
  const commentsCount = post.commentsCount || 0;

  // Avoid leaking full `likes` array to clients.
  const { likes: _likes, ...rest } = post;
  return {
    ...rest,
    likesCount,
    commentsCount,
    isLiked,
    authorRole: authorMeta?.role || null,
    authorIsVerified: !!authorMeta?.isVerified,
  };
}

// GET /api/community/posts?page=1&limit=10&subject=Biology
export const getPosts = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10), 10) || 10));
    const subject = req.query.subject ? String(req.query.subject) : null;

    const query = {};
    if (subject && subject !== 'All') query.subject = subject;

    const totalPosts = await CommunityPost.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalPosts / limit));

    const posts = await CommunityPost.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const authorIds = Array.from(new Set(posts.map((p) => p.authorId).filter(Boolean)));
    const authors = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid role isVerified')
      .lean();
    const authorMap = new Map(authors.map((a) => [a.firebaseUid, { role: a.role, isVerified: a.isVerified }]));

    const normalized = posts.map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, authorMap.get(p.authorId) || null)
    );

    res.json({
      posts: normalized,
      page,
      limit,
      totalPages,
      totalPosts,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts
export const createPost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { content, subject, imageUrl, type, poll } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });
    }

    const authorName = req.user.name || 'Student';
    const authorAvatar = computeInitials(authorName);

    const postType = type === 'poll' ? 'poll' : 'post';

    const postData = {
      authorId: currentUserFirebaseUid,
      authorName,
      authorAvatar,
      content: content.trim(),
      imageUrl: imageUrl || null,
      subject: subject || null,
      type: postType,
      likes: [],
      commentsCount: 0,
    };

    if (postType === 'poll') {
      const question = poll?.question ? String(poll.question).trim() : '';
      const endsAt = poll?.endsAt ? new Date(poll.endsAt) : null;

      const rawOptions = Array.isArray(poll?.options) ? poll.options : [];
      const options = rawOptions
        .map((o) => ({ text: (o?.text || '').toString().trim() }))
        .filter((o) => o.text.length > 0)
        .slice(0, 4);

      if (!question) return res.status(400).json({ success: false, error: 'poll.question is required' });
      if (options.length < 2) return res.status(400).json({ success: false, error: 'poll.options needs at least 2 options' });
      if (!endsAt || Number.isNaN(endsAt.getTime())) {
        return res.status(400).json({ success: false, error: 'poll.endsAt is required' });
      }

      postData.poll = {
        question,
        options: options.map((o) => ({ text: o.text, votes: [] })),
        endsAt,
      };
    }

    const post = await CommunityPost.create(postData);

    // Points system: create a post => +5 community points, +1 postsCount
    const user = await User.findById(req.user._id);
    if (user) {
      user.postsCount = (user.postsCount || 0) + 1;
      user.communityPoints = (user.communityPoints || 0) + 5;
      await recalcTotalPoints(user);
    }

    const postObj = post.toObject();
    const normalized = normalizePostForClient(postObj, currentUserFirebaseUid, {
      role: req.user?.role || null,
      isVerified: !!req.user?.isVerified,
    });

    res.status(201).json({ success: true, post: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/like
export const likePost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const alreadyLiked = (post.likes || []).includes(currentUserFirebaseUid);
    const pointsDelta = alreadyLiked ? -2 : 2;

    if (alreadyLiked) {
      post.likes = (post.likes || []).filter((uid) => uid !== currentUserFirebaseUid);
    } else {
      post.likes.push(currentUserFirebaseUid);
    }

    await post.save();

    // Points go to the post author.
    const authorUser = await User.findOne({ firebaseUid: post.authorId });
    if (authorUser) {
      authorUser.communityPoints = (authorUser.communityPoints || 0) + pointsDelta;
      await recalcTotalPoints(authorUser);
    }

    res.json({
      liked: !alreadyLiked,
      likesCount: (post.likes || []).length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/community/posts/:id
export const deletePost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    if (post.authorId !== currentUserFirebaseUid) {
      return res.status(403).json({ success: false, error: 'You can only delete your own posts' });
    }

    await CommunityPost.deleteOne({ _id: id });
    await CommunityComment.deleteMany({ postId: id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PATCH /api/community/posts/:id
// Allows only the post author to edit post content/subject/image.
// For poll posts, poll fields are only editable if the poll has zero votes (optional).
export const updatePost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user)
    const { id } = req.params

    const post = await CommunityPost.findById(id)
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' })
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' })
    if (post.authorId !== currentUserFirebaseUid) {
      return res.status(403).json({ success: false, error: 'You can only edit your own posts' })
    }

    const { content, subject, imageUrl, poll } = req.body || {}

    if (content !== undefined) {
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ success: false, error: 'content is required' })
      }
      if (content.length > 1000) {
        return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' })
      }
      post.content = content.trim()
    }

    if (subject !== undefined) {
      post.subject = subject ? String(subject) : null
    }

    if (imageUrl !== undefined) {
      post.imageUrl = imageUrl ? String(imageUrl) : null
    }

    if (poll !== undefined) {
      if (post.type !== 'poll') {
        return res.status(400).json({ success: false, error: 'This is not a poll post' })
      }

      // Only allow editing poll structure when there are no votes yet.
      const options = post.poll?.options || []
      const votesTotal = options.reduce((sum, o) => sum + (o?.votes?.length || 0), 0)
      if (votesTotal > 0) {
        return res.status(403).json({
          success: false,
          error: 'Poll has votes; editing poll question/options is disabled',
        })
      }

      const question = poll?.question ? String(poll.question).trim() : ''
      const endsAt = poll?.endsAt ? new Date(poll.endsAt) : null
      const rawOptions = Array.isArray(poll?.options) ? poll.options : []
      const nextOptions = rawOptions
        .map((o) => ({ text: (o?.text || '').toString().trim() }))
        .filter((o) => o.text.length > 0)
        .slice(0, 4)

      if (!question) return res.status(400).json({ success: false, error: 'poll.question is required' })
      if (nextOptions.length < 2) return res.status(400).json({ success: false, error: 'poll.options needs at least 2 options' })
      if (!endsAt || Number.isNaN(endsAt.getTime())) {
        return res.status(400).json({ success: false, error: 'poll.endsAt is required' })
      }

      post.poll = {
        question,
        options: nextOptions.map((o) => ({ text: o.text, votes: [] })),
        endsAt,
      }
    }

    await post.save()
      const author = await User.findOne({ firebaseUid: post.authorId }).select('role isVerified').lean()
      const normalized = normalizePostForClient(post.toObject(), currentUserFirebaseUid, author)
    res.json({ success: true, post: normalized })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

// GET /api/community/posts/:id/comments
export const getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const comments = await CommunityComment.find({ postId: id })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ comments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/comments
export const addComment = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { content } = req.body || {};

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    if (content.length > 500) {
      return res.status(400).json({ success: false, error: 'content exceeds 500 characters' });
    }

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const authorName = req.user.name || 'Student';
    const authorAvatar = computeInitials(authorName);

    const comment = await CommunityComment.create({
      postId: post._id,
      authorId: currentUserFirebaseUid,
      authorName,
      authorAvatar,
      content: content.trim(),
      likes: [],
    });

    await CommunityPost.findByIdAndUpdate(post._id, { $inc: { commentsCount: 1 } });

    // Points: comment on a post => +3 community points
    const commenter = await User.findById(req.user._id);
    if (commenter) {
      commenter.communityPoints = (commenter.communityPoints || 0) + 3;
      await recalcTotalPoints(commenter);
    }

    res.status(201).json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/vote
export const votePoll = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { optionIndex } = req.body || {};

    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    if (post.type !== 'poll' || !post.poll) {
      return res.status(400).json({ success: false, error: 'Not a poll post' });
    }

    if (post.poll.endsAt && new Date(post.poll.endsAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Poll has ended' });
    }

    const idx = Number.isInteger(optionIndex) ? optionIndex : parseInt(String(optionIndex), 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= (post.poll.options || []).length) {
      return res.status(400).json({ success: false, error: 'Invalid optionIndex' });
    }

    // Remove existing vote then add to the selected option.
    (post.poll.options || []).forEach((opt) => {
      opt.votes = (opt.votes || []).filter((uid) => uid !== currentUserFirebaseUid);
    });

    const selected = post.poll.options[idx];
    selected.votes = selected.votes || [];
    if (!selected.votes.includes(currentUserFirebaseUid)) selected.votes.push(currentUserFirebaseUid);

    await post.save();

    // Points: vote in a poll => +1 community points
    const voter = await User.findById(req.user._id);
    if (voter) {
      voter.communityPoints = (voter.communityPoints || 0) + 1;
      await recalcTotalPoints(voter);
    }

    const options = (post.poll.options || []).map((o) => ({
      text: o.text,
      votesCount: (o.votes || []).length,
    }));

    const yourVoteIndex = (post.poll.options || []).findIndex((o) =>
      (o.votes || []).includes(currentUserFirebaseUid)
    );

    res.json({
      options,
      yourVoteIndex,
      endsAt: post.poll.endsAt || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/leaderboard
export const getLeaderboard = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const myUser = await User.findOne({ firebaseUid: currentUserFirebaseUid }).lean();
    if (!myUser) {
      return res.json({ leaderboard: [], myRank: 0, myEntry: null });
    }

    const myTotal = myUser.totalPoints || 0;
    const myRank = (await User.countDocuments({ totalPoints: { $gt: myTotal } })) + 1;

    const topUsers = await User.find()
      .sort({ totalPoints: -1 })
      .limit(20)
      .lean();

    const leaderboard = topUsers.map((u) => ({
      name: u.name || 'Anonymous',
      avatar: computeInitials(u.name || 'Anonymous'),
      totalPoints: u.totalPoints || 0,
      cbtPoints: u.cbtPoints || 0,
      communityPoints: u.communityPoints || 0,
      postsCount: u.postsCount || 0,
      userId: u.firebaseUid,
    }));

    res.json({
      leaderboard,
      myRank,
      myEntry: {
        name: myUser.name || 'Anonymous',
        avatar: computeInitials(myUser.name || 'Anonymous'),
        totalPoints: myUser.totalPoints || 0,
        cbtPoints: myUser.cbtPoints || 0,
        communityPoints: myUser.communityPoints || 0,
        postsCount: myUser.postsCount || 0,
        userId: myUser.firebaseUid,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/upload-image
export const uploadCommunityImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    // Upload as base64 data URI (works with our simple Next proxy forwarding).
    const base64 = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'image',
      folder: 'studyhelp/community',
      access_mode: 'public',
    });

    res.json({ success: true, imageUrl: result.secure_url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────────────────────────────────────

function canAccessGroup(group, firebaseUid) {
  return !!group && !!firebaseUid && (group.members || []).includes(firebaseUid);
}

// GET /api/community/users/search?q=jo
export const searchUsers = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ users: [] });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await User.find({
      $or: [{ name: rx }, { email: rx }],
      firebaseUid: { $ne: currentUid, $exists: true, $ne: null },
    })
      .select('name email firebaseUid')
      .limit(12)
      .lean();

    const users = rows.map((u) => ({
      uid: u.firebaseUid,
      name: u.name || 'Student',
      email: u.email || '',
      avatar: computeInitials(u.name || 'Student'),
    }));

    res.json({ users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/groups
export const getGroups = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    const groups = await CommunityGroup.find({ members: currentUid })
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/groups
// body: { name, description?, memberIds?: string[] }
export const createGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, description, memberIds } = req.body || {};
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return res.status(400).json({ success: false, error: 'name is required' });

    const list = Array.isArray(memberIds) ? memberIds.filter((x) => typeof x === 'string' && x.trim()) : [];
    const members = Array.from(new Set([currentUid, ...list]));

    const group = await CommunityGroup.create({
      name: trimmedName,
      description: String(description || '').trim(),
      createdBy: currentUid,
      members,
    });

    res.status(201).json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/groups/:id/members
// body: { userId }
export const addGroupMember = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { userId } = req.body || {};

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const group = await CommunityGroup.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!canAccessGroup(group, currentUid)) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }

    if (!(group.members || []).includes(userId)) group.members.push(userId);
    await group.save();

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/groups/:id/messages
export const getGroupMessages = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    const { id } = req.params;

    const group = await CommunityGroup.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!canAccessGroup(group, currentUid)) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }

    const messages = await CommunityGroupMessage.find({ groupId: id })
      .sort({ createdAt: 1 })
      .limit(300)
      .lean();

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/groups/:id/messages
// body: { content }
export const sendGroupMessage = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { content } = req.body || {};

    const text = String(content || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'content is required' });
    if (text.length > 1000) return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });

    const group = await CommunityGroup.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!canAccessGroup(group, currentUid)) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }

    const authorName = req.user?.name || 'Student';
    const authorAvatar = computeInitials(authorName);
    const message = await CommunityGroupMessage.create({
      groupId: id,
      authorId: currentUid,
      authorName,
      authorAvatar,
      content: text,
    });

    // simple activity bump
    await CommunityGroup.findByIdAndUpdate(id, { $set: { updatedAt: new Date() } });

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

