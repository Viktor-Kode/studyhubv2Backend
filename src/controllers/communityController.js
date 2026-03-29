import cloudinary from '../config/cloudinary.js';
import User from '../models/User.js';
import CommunityPost from '../models/CommunityPost.js';
import CommunityComment from '../models/CommunityComment.js';
import CommunityNotification from '../models/CommunityNotification.js';
import CommunityReport from '../models/CommunityReport.js';
import CommunityGroup from '../models/CommunityGroup.js';
import CommunityGroupMessage from '../models/CommunityGroupMessage.js';
import { getStreak } from '../services/streakService.js';
import {
  COMMUNITY_BADGE_CATALOG,
  createCommunityNotification,
  checkFirstPostBadge,
  checkStreak30Badge,
  checkTopAnswererBadge,
  checkPopularPostBadge,
  resolveMentionNamesInComment,
} from '../services/communityEngagementService.js';
import { sendNotification } from '../services/notificationService.js';
import { markUserProgress } from '../utils/markUserProgress.js';

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

function rankTierFromPoints(totalPoints) {
  const n = Number(totalPoints) || 0;
  if (n >= 2000) return 'Campus Champion';
  if (n >= 1000) return 'Top Scholar';
  if (n >= 500) return 'Serious Scholar';
  if (n >= 200) return 'Active Learner';
  return 'Beginner';
}

function mergeTagsFromBodyAndContent(bodyTags, content) {
  const set = new Set();
  if (Array.isArray(bodyTags)) {
    for (const t of bodyTags) {
      const x = String(t || '')
        .replace(/^#/, '')
        .trim()
        .toLowerCase();
      if (x.length >= 2 && x.length <= 40) set.add(x);
    }
  }
  const re = /#([a-zA-Z0-9_]{2,40})/g;
  let m;
  const text = String(content || '');
  while ((m = re.exec(text)) !== null) set.add(m[1].toLowerCase());
  return [...set].slice(0, 8);
}

async function bookmarkSetForUser(userMongoId) {
  const u = await User.findById(userMongoId).select('communityBookmarks').lean();
  return new Set((u?.communityBookmarks || []).map((id) => String(id)));
}

function normalizePostForClient(post, currentUserFirebaseUid, authorMeta = null, bookmarkSet = null) {
  const likes = post.likes || [];
  const likesCount = likes.length;
  const isLiked = !!currentUserFirebaseUid && likes.includes(currentUserFirebaseUid);
  const commentsCount = post.commentsCount || 0;
  const pid = post._id ? String(post._id) : '';
  const isBookmarked = !!(bookmarkSet && pid && bookmarkSet.has(pid));

  // Avoid leaking full `likes` array to clients.
  const { likes: _likes, ...rest } = post;
  return {
    ...rest,
    tags: post.tags || [],
    isPinned: !!post.isPinned,
    views: post.views ?? 0,
    bestAnswerCommentId: post.bestAnswerCommentId ? String(post.bestAnswerCommentId) : null,
    likesCount,
    commentsCount,
    isLiked,
    isBookmarked,
    authorRole: authorMeta?.role || null,
    authorIsVerified: !!authorMeta?.isVerified,
  };
}

// GET /api/community/posts?page&limit&subject&author&q&tag&sort=feed|newest|trending
export const getPosts = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10), 10) || 10));
    const subject = req.query.subject ? String(req.query.subject) : null;
    const author = req.query.author ? String(req.query.author).trim() : null;
    const qRaw = req.query.q || req.query.query;
    const q = qRaw ? String(qRaw).trim() : null;
    const tag = req.query.tag ? String(req.query.tag).replace(/^#/, '').trim() : null;
    const sortMode = String(req.query.sort || 'feed').toLowerCase();

    const match = {};
    if (subject && subject !== 'All') match.subject = subject;
    if (author) match.authorId = author;
    if (tag) match.tags = tag;
    if (q && q.length > 0) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [{ content: rx }, { authorName: rx }, { subject: rx }, { tags: rx }];
    }

    const bookmarkSet = await bookmarkSetForUser(req.user._id);

    let totalPosts;
    let posts;

    if (sortMode === 'newest') {
      totalPosts = await CommunityPost.countDocuments(match);
      posts = await CommunityPost.find(match)
        .sort({ isPinned: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    } else {
      const pipeline = [
        { $match: match },
        {
          $addFields: {
            trendScore: {
              $add: [{ $size: { $ifNull: ['$likes', []] } }, { $multiply: [{ $ifNull: ['$commentsCount', 0] }, 2] }],
            },
          },
        },
        { $sort: { isPinned: -1, trendScore: -1, createdAt: -1 } },
        {
          $facet: {
            meta: [{ $count: 'total' }],
            data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          },
        },
      ];
      const agg = await CommunityPost.aggregate(pipeline);
      totalPosts = agg[0]?.meta[0]?.total ?? 0;
      posts = agg[0]?.data ?? [];
    }

    const totalPages = Math.max(1, Math.ceil(totalPosts / limit));

    const authorIds = Array.from(new Set(posts.map((p) => p.authorId).filter(Boolean)));
    const authors = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid role isVerified')
      .lean();
    const authorMap = new Map(authors.map((a) => [a.firebaseUid, { role: a.role, isVerified: a.isVerified }]));

    const normalized = posts.map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, authorMap.get(p.authorId) || null, bookmarkSet)
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

// GET /api/community/updates?since=ISO_TIMESTAMP&latestPostId=xxx
// Smart polling:
// - newPosts: full normalized posts created after `since`
// - updatedPosts: lightweight updates (id + likes + commentsCount) for posts updated after `since`,
//   excluding new posts.
export const getCommunityUpdates = async (req, res) => {
  try {
    const { since } = req.query;

    let sinceDate = since ? new Date(String(since)) : new Date(Date.now() - 30000);
    if (Number.isNaN(sinceDate.getTime())) sinceDate = new Date(Date.now() - 30000);

    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const bookmarkSet = await bookmarkSetForUser(req.user._id);

    // New posts since last check
    const newPostsRaw = await CommunityPost.find({
      createdAt: { $gt: sinceDate },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const newAuthorIds = Array.from(new Set((newPostsRaw || []).map((p) => p.authorId).filter(Boolean)));
    const newAuthors = await User.find({ firebaseUid: { $in: newAuthorIds } })
      .select('firebaseUid role isVerified')
      .lean();
    const newAuthorMap = new Map((newAuthors || []).map((u) => [u.firebaseUid, { role: u.role, isVerified: u.isVerified }]));

    const newPosts = (newPostsRaw || []).map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, newAuthorMap.get(p.authorId) || null, bookmarkSet),
    );

    // Updated (liked/commented/etc.) posts since last check, excluding ones created after `sinceDate`
    const updatedPostsRaw = await CommunityPost.find({
      updatedAt: { $gt: sinceDate },
      createdAt: { $lte: sinceDate },
    })
      .select('_id likes commentsCount')
      .lean();

    const updatedPosts = (updatedPostsRaw || []).map((p) => ({
      _id: String(p._id),
      likes: p.likes || [],
      commentsCount: p.commentsCount || 0,
    }));

    res.json({
      newPosts,
      updatedPosts,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
};

// GET /api/community/profile?userId=firebaseUid (optional; default = current user)
export const getCommunityProfile = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const qUser = req.query.userId || req.query.user;
    const requestedUid = qUser ? String(qUser).trim() : currentUserFirebaseUid;
    const targetUser = await User.findOne({ firebaseUid: requestedUid }).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isSelf = requestedUid === currentUserFirebaseUid;
    const streakDoc = await getStreak(targetUser._id);
    const streak =
      streakDoc && typeof streakDoc === 'object' && 'currentStreak' in streakDoc
        ? streakDoc.currentStreak || 0
        : 0;

    const boardQuery = { role: { $ne: 'admin' } };
    const isTargetAdmin = targetUser.role === 'admin';
    const total = targetUser.totalPoints || 0;
    const leaderboardRank = isTargetAdmin
      ? 0
      : (await User.countDocuments({ ...boardQuery, totalPoints: { $gt: total } })) + 1;

    const earned = targetUser.communityBadges || [];
    const badges = COMMUNITY_BADGE_CATALOG.filter((b) => earned.includes(b.id));

    res.json({
      success: true,
      profile: {
        userId: targetUser.firebaseUid,
        name: targetUser.name || 'Student',
        avatar: computeInitials(targetUser.name || 'Student'),
        rankTier: rankTierFromPoints(total),
        rank: rankTierFromPoints(total),
        totalPoints: total,
        communityPoints: targetUser.communityPoints || 0,
        cbtPoints: targetUser.cbtPoints || 0,
        postsCount: targetUser.postsCount || 0,
        streak,
        memberSince: targetUser.createdAt || null,
        leaderboardRank,
        isSelf,
        role: targetUser.role || 'student',
        isVerified: !!targetUser.isVerified,
        badges,
        badgeIds: earned,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/liked-posts?page&limit
export const getLikedPosts = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10), 10) || 10));

    const query = { likes: currentUserFirebaseUid };
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

    const bookmarkSet = await bookmarkSetForUser(req.user._id);
    const normalized = posts.map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, authorMap.get(p.authorId) || null, bookmarkSet)
    );

    res.json({
      success: true,
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

    const { content, subject, imageUrl, type, poll, tags: bodyTags } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });
    }

    const authorName = req.user.name || 'Student';
    const authorAvatar = computeInitials(authorName);

    const postType = type === 'poll' ? 'poll' : type === 'question' ? 'question' : 'post';
    const tags = mergeTagsFromBodyAndContent(bodyTags, content.trim());

    const postData = {
      authorId: currentUserFirebaseUid,
      authorName,
      authorAvatar,
      content: content.trim(),
      imageUrl: imageUrl || null,
      subject: subject || null,
      tags,
      type: postType,
      likes: [],
      commentsCount: 0,
      views: 0,
      isPinned: false,
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
      await checkFirstPostBadge(user);
      await checkStreak30Badge(user._id);
    }

    await markUserProgress(req.user._id, 'community');

    const bookmarkSet = await bookmarkSetForUser(req.user._id);
    const postObj = post.toObject();
    const normalized = normalizePostForClient(postObj, currentUserFirebaseUid, {
      role: req.user?.role || null,
      isVerified: !!req.user?.isVerified,
    }, bookmarkSet);

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

    const lc = (post.likes || []).length;
    if (authorUser && !alreadyLiked) {
      await checkPopularPostBadge(authorUser, lc);
    }

    if (!alreadyLiked && post.authorId !== currentUserFirebaseUid) {
      await createCommunityNotification({
        recipientFirebaseUid: post.authorId,
        type: 'like',
        actorFirebaseUid: currentUserFirebaseUid,
        actorName: req.user.name || 'Someone',
        postId: post._id,
      });
      const preview = String(post.content || '').slice(0, 60);
      void sendNotification({
        userId: post.authorId,
        type: 'post_like',
        title: `${req.user.name || 'Someone'} liked your post`,
        body: preview + (preview.length >= 60 ? '…' : ''),
        icon: '❤️',
        link: '/community',
        data: { postId: String(post._id) },
      });
    }

    res.json({
      liked: !alreadyLiked,
      likesCount: lc,
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

// PATCH / PUT /api/community/posts/:id — owner only.
// Polls with votes: only content, subject, imageUrl may change (options frozen).
// Polls with zero votes: may send pollOptions (string[]) and/or legacy poll object.
export const updatePost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (post.authorId !== currentUserFirebaseUid) {
      return res.status(403).json({ success: false, error: 'You can only edit your own posts' });
    }

    const { content, subject, imageUrl, poll, pollOptions, tags: bodyTags } = req.body || {};
    const options = post.poll?.options || [];
    const votesTotal = options.reduce((sum, o) => sum + (o?.votes?.length || 0), 0);

    if (votesTotal > 0 && (poll !== undefined || pollOptions !== undefined)) {
      return res.status(403).json({
        success: false,
        error: 'Poll has votes; only text and subject can be updated',
      });
    }

    if (content !== undefined) {
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ success: false, error: 'content is required' });
      }
      if (content.length > 1000) {
        return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });
      }
      post.content = content.trim();
      if (post.type === 'poll' && post.poll) {
        post.poll.question = post.content;
      }
    }

    if (subject !== undefined) {
      post.subject = subject ? String(subject) : null;
    }

    if (imageUrl !== undefined) {
      post.imageUrl = imageUrl ? String(imageUrl) : null;
    }

    if (bodyTags !== undefined) {
      post.tags = mergeTagsFromBodyAndContent(bodyTags, post.content || '');
    }

    if (post.type === 'poll' && pollOptions !== undefined && votesTotal === 0) {
      const texts = Array.isArray(pollOptions)
        ? pollOptions.map((t) => String(t || '').trim()).filter(Boolean)
        : [];
      if (texts.length < 2) {
        return res.status(400).json({ success: false, error: 'pollOptions needs at least 2 non-empty strings' });
      }
      const endsAt = post.poll?.endsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      post.poll = {
        question: post.content || post.poll?.question || '',
        options: texts.slice(0, 4).map((text) => ({ text, votes: [] })),
        endsAt,
      };
    }

    if (poll !== undefined && post.type === 'poll' && votesTotal === 0) {
      const question = poll?.question ? String(poll.question).trim() : '';
      const endsAt = poll?.endsAt ? new Date(poll.endsAt) : post.poll?.endsAt || null;
      const rawOptions = Array.isArray(poll?.options) ? poll.options : [];
      const nextOptions = rawOptions
        .map((o) => ({ text: (o?.text || '').toString().trim() }))
        .filter((o) => o.text.length > 0)
        .slice(0, 4);

      if (!question) return res.status(400).json({ success: false, error: 'poll.question is required' });
      if (nextOptions.length < 2) return res.status(400).json({ success: false, error: 'poll.options needs at least 2 options' });
      if (!endsAt || Number.isNaN(endsAt.getTime())) {
        return res.status(400).json({ success: false, error: 'poll.endsAt is required' });
      }

      post.content = question;
      post.poll = {
        question,
        options: nextOptions.map((o) => ({ text: o.text, votes: [] })),
        endsAt,
      };
    }

    await post.save();
    const author = await User.findOne({ firebaseUid: post.authorId }).select('role isVerified').lean();
    const bset = await bookmarkSetForUser(req.user._id);
    const normalized = normalizePostForClient(post.toObject(), currentUserFirebaseUid, author, bset);
    res.json({ success: true, post: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/posts/:id/comments
export const getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserFirebaseUid = getFirebaseUid(req.user);

    const parentIdRaw = req.query.parentId;
    const parentId =
      parentIdRaw === undefined || parentIdRaw === null || parentIdRaw === '' || String(parentIdRaw) === 'null'
        ? null
        : String(parentIdRaw);

    const comments = await CommunityComment.find({
      postId: id,
      ...(parentId === null ? { parentId: null } : { parentId }),
    })
      .sort({ createdAt: 1 })
      .lean();

    const authorIds = Array.from(new Set(comments.map((c) => c.authorId).filter(Boolean)));
    const users = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid totalPoints')
      .lean();
    const authorMap = new Map((users || []).map((u) => [u.firebaseUid, u]));

    const normalized = comments.map((c) => {
      const likes = c.likes || [];
      const likesCount = likes.length;
      const isLiked = !!currentUserFirebaseUid && likes.includes(currentUserFirebaseUid);
      const authorUser = authorMap.get(c.authorId);
      return {
        _id: String(c._id),
        postId: String(c.postId),
        parentId: c.parentId ? String(c.parentId) : null,
        authorId: c.authorId,
        authorName: c.authorName,
        authorAvatar: c.authorAvatar || null,
        authorRank: rankTierFromPoints(authorUser?.totalPoints || 0),
        content: c.content,
        createdAt: c.createdAt,
        likesCount,
        isLiked,
      };
    });

    res.json({ comments: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

function assertOwner(firebaseUid, comment) {
  return firebaseUid && comment?.authorId && String(comment.authorId) === String(firebaseUid);
}

function assertCommentBelongsToPost(comment, postId) {
  return !!comment && String(comment.postId) === String(postId);
}

function getCommentMentionUidsFromContent(content) {
  return resolveMentionNamesInComment(content.trim());
}

// POST /api/community/posts/:id/comments
// body: { content: string, parentId?: string|null }
export const addComment = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { content, parentId } = req.body || {};

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

    const mentionedFirebaseUids = await getCommentMentionUidsFromContent(content.trim());

    let parentComment = null;
    const parentIdStr = parentId === undefined || parentId === null || parentId === '' ? null : String(parentId);
    if (parentIdStr) {
      parentComment = await CommunityComment.findOne({ _id: parentIdStr, postId: post._id }).lean();
      if (!parentComment) {
        return res.status(404).json({ success: false, error: 'Parent comment not found' });
      }
    }

    const comment = await CommunityComment.create({
      postId: post._id,
      parentId: parentComment ? parentComment._id : null,
      authorId: currentUserFirebaseUid,
      authorName,
      authorAvatar,
      content: content.trim(),
      likes: [],
      mentionedFirebaseUids,
    });

    // Use document + save() so Mongoose bumps updatedAt via timestamps.
    post.commentsCount = (post.commentsCount || 0) + 1;
    await post.save();

    // Points: comment on a post => +3 community points
    const commenter = await User.findById(req.user._id);
    if (commenter) {
      commenter.communityPoints = (commenter.communityPoints || 0) + 3;
      await recalcTotalPoints(commenter);
    }

    if (post.authorId !== currentUserFirebaseUid) {
      await createCommunityNotification({
        recipientFirebaseUid: post.authorId,
        type: 'comment',
        actorFirebaseUid: currentUserFirebaseUid,
        actorName: authorName,
        postId: post._id,
        commentId: comment._id,
      });
      const cprev = String(content || '').trim().slice(0, 60);
      void sendNotification({
        userId: post.authorId,
        type: 'post_comment',
        title: `${authorName} commented on your post`,
        body: cprev + (cprev.length >= 60 ? '…' : ''),
        icon: '💬',
        link: '/community',
        data: { postId: String(post._id) },
      });
    }
    for (const uid of mentionedFirebaseUids) {
      if (uid === currentUserFirebaseUid) continue;
      await createCommunityNotification({
        recipientFirebaseUid: uid,
        type: 'mention',
        actorFirebaseUid: currentUserFirebaseUid,
        actorName: authorName,
        postId: post._id,
        commentId: comment._id,
      });
    }

    const authorUser = await User.findOne({ firebaseUid: currentUserFirebaseUid }).select('totalPoints').lean();
    res.status(201).json({
      success: true,
      comment: {
        _id: String(comment._id),
        postId: String(comment.postId),
        parentId: comment.parentId ? String(comment.parentId) : null,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorAvatar: comment.authorAvatar || null,
        authorRank: rankTierFromPoints(authorUser?.totalPoints || 0),
        content: comment.content,
        createdAt: comment.createdAt,
        likesCount: 0,
        isLiked: false,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/comments/:commentId/like
export const toggleCommentLike = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { commentId } = req.params;

    const comment = await CommunityComment.findById(commentId);
    if (!comment || String(comment.postId) !== String(id)) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }

    const likes = comment.likes || [];
    const alreadyLiked = likes.includes(currentUserFirebaseUid);
    const pointsDelta = alreadyLiked ? -2 : 2;

    comment.likes = alreadyLiked ? likes.filter((uid) => uid !== currentUserFirebaseUid) : [...likes, currentUserFirebaseUid];
    await comment.save();

    // Points: comment like goes to the comment author.
    const authorUser = await User.findOne({ firebaseUid: comment.authorId });
    if (authorUser) {
      authorUser.communityPoints = (authorUser.communityPoints || 0) + pointsDelta;
      await recalcTotalPoints(authorUser);
    }

    if (!alreadyLiked && comment.authorId !== currentUserFirebaseUid) {
      await createCommunityNotification({
        recipientFirebaseUid: comment.authorId,
        type: 'comment_like',
        actorFirebaseUid: currentUserFirebaseUid,
        actorName: req.user.name || 'Someone',
        postId: comment.postId,
        commentId: comment._id,
      });
    }

    res.json({ liked: !alreadyLiked, likesCount: comment.likes.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/community/posts/:id/comments/:commentId
export const updateComment = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { commentId } = req.params;
    const { content } = req.body || {};

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    if (content.length > 500) {
      return res.status(400).json({ success: false, error: 'content exceeds 500 characters' });
    }

    const comment = await CommunityComment.findById(commentId);
    if (!comment || !assertCommentBelongsToPost(comment, id)) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }

    if (!assertOwner(currentUserFirebaseUid, comment)) {
      return res.status(403).json({ success: false, error: 'You can only edit your own comments' });
    }

    comment.content = content.trim();
    comment.mentionedFirebaseUids = await getCommentMentionUidsFromContent(comment.content);
    await comment.save();

    const authorUser = await User.findOne({ firebaseUid: comment.authorId }).select('totalPoints').lean();
    const likes = comment.likes || [];
    const currentUserLikes = !!currentUserFirebaseUid && likes.includes(currentUserFirebaseUid);

    res.json({
      success: true,
      comment: {
        _id: String(comment._id),
        postId: String(comment.postId),
        parentId: comment.parentId ? String(comment.parentId) : null,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorAvatar: comment.authorAvatar || null,
        authorRank: rankTierFromPoints(authorUser?.totalPoints || 0),
        content: comment.content,
        createdAt: comment.createdAt,
        likesCount: likes.length,
        isLiked: currentUserLikes,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/community/posts/:id/comments/:commentId
export const deleteComment = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { commentId } = req.params;

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const root = await CommunityComment.findById(commentId);
    if (!root || !assertCommentBelongsToPost(root, id)) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }

    if (!assertOwner(currentUserFirebaseUid, root)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own comments' });
    }

    // Collect root + all descendants.
    const idsToDelete = [];
    const queue = [root._id];
    while (queue.length > 0) {
      const curId = queue.shift();
      idsToDelete.push(curId);
      const children = await CommunityComment.find({ postId: post._id, parentId: curId }).select('_id').lean();
      for (const child of children || []) queue.push(child._id);
    }

    await CommunityComment.deleteMany({ _id: { $in: idsToDelete } });

    // Keep post.commentsCount roughly in sync (includes replies as well).
    const nextCount = Math.max(0, (post.commentsCount || 0) - idsToDelete.length);
    post.commentsCount = nextCount;
    if (post.bestAnswerCommentId && idsToDelete.some((x) => String(x) === String(post.bestAnswerCommentId))) {
      post.bestAnswerCommentId = null;
    }
    await post.save();

    res.json({ success: true });
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

    const boardQuery = { role: { $ne: 'admin' } };
    const isCurrentUserAdmin = myUser.role === 'admin';
    const myTotal = myUser.totalPoints || 0;
    const myRank = isCurrentUserAdmin
      ? 0
      : (await User.countDocuments({ ...boardQuery, totalPoints: { $gt: myTotal } })) + 1;

    const streakDoc = await getStreak(myUser._id);
    const myStreak =
      streakDoc && typeof streakDoc === 'object' && 'currentStreak' in streakDoc
        ? streakDoc.currentStreak || 0
        : 0;

    const topUsers = await User.find(boardQuery)
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
      myEntry: isCurrentUserAdmin
        ? null
        : {
            name: myUser.name || 'Anonymous',
            avatar: computeInitials(myUser.name || 'Anonymous'),
            totalPoints: myUser.totalPoints || 0,
            cbtPoints: myUser.cbtPoints || 0,
            communityPoints: myUser.communityPoints || 0,
            postsCount: myUser.postsCount || 0,
            userId: myUser.firebaseUid,
            streak: myStreak,
          },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/best-answer  body: { commentId }
export const markBestAnswer = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { commentId } = req.body || {};
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!commentId) return res.status(400).json({ success: false, error: 'commentId is required' });

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (post.type !== 'question') {
      return res.status(400).json({ success: false, error: 'Best answer is only for questions' });
    }
    if (post.authorId !== currentUserFirebaseUid) {
      return res.status(403).json({ success: false, error: 'Only the author can mark best answer' });
    }

    const comment = await CommunityComment.findOne({ _id: commentId, postId: post._id });
    if (!comment) return res.status(404).json({ success: false, error: 'Comment not found' });
    if (post.bestAnswerCommentId) {
      return res.status(400).json({ success: false, error: 'Best answer is already set for this question' });
    }

    post.bestAnswerCommentId = comment._id;
    await post.save();

    const answerAuthor = await User.findOne({ firebaseUid: comment.authorId });
    if (answerAuthor) {
      answerAuthor.communityPoints = (answerAuthor.communityPoints || 0) + 10;
      answerAuthor.bestAnswersCount = (answerAuthor.bestAnswersCount || 0) + 1;
      await recalcTotalPoints(answerAuthor);
      await checkTopAnswererBadge(answerAuthor);
    }

    await createCommunityNotification({
      recipientFirebaseUid: comment.authorId,
      type: 'bestAnswer',
      actorFirebaseUid: currentUserFirebaseUid,
      actorName: req.user.name || 'Someone',
      postId: post._id,
      commentId: comment._id,
    });

    const bset = await bookmarkSetForUser(req.user._id);
    const authorMeta = await User.findOne({ firebaseUid: post.authorId }).select('role isVerified').lean();
    const normalized = normalizePostForClient(
      post.toObject(),
      currentUserFirebaseUid,
      authorMeta ? { role: authorMeta.role, isVerified: authorMeta.isVerified } : null,
      bset
    );
    res.json({ success: true, post: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/bookmark — toggle
export const toggleBookmark = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    user.communityBookmarks = user.communityBookmarks || [];
    const bid = post._id;
    const idx = user.communityBookmarks.findIndex((x) => String(x) === String(bid));
    let bookmarked;
    if (idx >= 0) {
      user.communityBookmarks.splice(idx, 1);
      bookmarked = false;
    } else {
      user.communityBookmarks.push(bid);
      bookmarked = true;
    }
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, bookmarked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/bookmarks?page&limit
export const getBookmarkedPosts = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10), 10) || 10));

    const user = await User.findOne({ firebaseUid: currentUserFirebaseUid }).select('communityBookmarks').lean();
    const ids = user?.communityBookmarks || [];
    const totalPosts = ids.length;
    const totalPages = Math.max(1, Math.ceil(totalPosts / limit));
    const slice = ids.slice((page - 1) * limit, page * limit);
    const posts = await CommunityPost.find({ _id: { $in: slice } })
      .lean()
      .then((rows) => {
        const map = new Map(rows.map((r) => [String(r._id), r]));
        return slice.map((oid) => map.get(String(oid))).filter(Boolean);
      });

    const bookmarkSet = await bookmarkSetForUser(req.user._id);
    const authorIds = Array.from(new Set(posts.map((p) => p.authorId).filter(Boolean)));
    const authors = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid role isVerified')
      .lean();
    const authorMap = new Map(authors.map((a) => [a.firebaseUid, { role: a.role, isVerified: a.isVerified }]));

    const normalized = posts.map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, authorMap.get(p.authorId) || null, bookmarkSet)
    );

    res.json({ success: true, posts: normalized, page, limit, totalPages, totalPosts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/report  body: { reason, commentId? }
export const reportPost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const { id } = req.params;
    const { reason, commentId } = req.body || {};
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const text = String(reason || '').trim();
    if (text.length < 3) return res.status(400).json({ success: false, error: 'reason is required' });

    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    let coid = null;
    if (commentId) {
      const c = await CommunityComment.findOne({ _id: commentId, postId: post._id });
      if (!c) return res.status(404).json({ success: false, error: 'Comment not found' });
      coid = c._id;
    }

    await CommunityReport.create({
      postId: post._id,
      commentId: coid,
      reporterFirebaseUid: currentUserFirebaseUid,
      reason: text.slice(0, 500),
    });

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/community/posts/:id/pin  body: { pinned: boolean }
export const pinPost = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });

    const { id } = req.params;
    const pinned = !!req.body?.pinned;
    const post = await CommunityPost.findById(id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    post.isPinned = pinned;
    await post.save();

    const bset = await bookmarkSetForUser(req.user._id);
    const authorMeta = await User.findOne({ firebaseUid: post.authorId }).select('role isVerified').lean();
    const normalized = normalizePostForClient(
      post.toObject(),
      currentUserFirebaseUid,
      authorMeta ? { role: authorMeta.role, isVerified: authorMeta.isVerified } : null,
      bset
    );
    res.json({ success: true, post: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/trending
export const getTrending = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    const since = new Date(Date.now() - 7 * 86400000);
    const rows = await CommunityPost.find({ createdAt: { $gte: since } }).lean();
    const scored = rows
      .map((p) => ({
        p,
        s: (p.likes?.length || 0) + 2 * (p.commentsCount || 0),
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.p);

    const bookmarkSet = currentUserFirebaseUid ? await bookmarkSetForUser(req.user._id) : null;
    const authorIds = Array.from(new Set(scored.map((p) => p.authorId).filter(Boolean)));
    const authors = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid role isVerified')
      .lean();
    const authorMap = new Map(authors.map((a) => [a.firebaseUid, { role: a.role, isVerified: a.isVerified }]));

    const posts = scored.map((p) =>
      normalizePostForClient(p, currentUserFirebaseUid, authorMap.get(p.authorId) || null, bookmarkSet)
    );
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/me
export const getCommunityMe = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const user = await User.findOne({ firebaseUid: currentUserFirebaseUid }).lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const streakDoc = await getStreak(user._id);
    const streak =
      streakDoc && typeof streakDoc === 'object' && 'currentStreak' in streakDoc
        ? streakDoc.currentStreak || 0
        : 0;

    const unreadNotifications = await CommunityNotification.countDocuments({
      recipientFirebaseUid: currentUserFirebaseUid,
      read: false,
    });

    const earned = user.communityBadges || [];
    const badges = COMMUNITY_BADGE_CATALOG.filter((b) => earned.includes(b.id));

    res.json({
      success: true,
      me: {
        userId: user.firebaseUid,
        name: user.name,
        rank: rankTierFromPoints(user.totalPoints || 0),
        totalPoints: user.totalPoints || 0,
        communityPoints: user.communityPoints || 0,
        streak,
        bookmarksCount: (user.communityBookmarks || []).length,
        unreadNotifications,
        badges,
        badgeIds: earned,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/stats
export const getCommunityStats = async (req, res) => {
  try {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const dayAgo = new Date(Date.now() - 86400000);

    const [totalMembers, postsToday, activeUsers] = await Promise.all([
      User.countDocuments({ firebaseUid: { $exists: true, $ne: null } }),
      CommunityPost.countDocuments({ createdAt: { $gte: start } }),
      User.countDocuments({ lastSeen: { $gte: dayAgo } }),
    ]);

    res.json({
      success: true,
      stats: { totalMembers, postsToday, activeUsers },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/notifications?limit=
export const getNotifications = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || 40), 10) || 40));
    const items = await CommunityNotification.find({ recipientFirebaseUid: currentUserFirebaseUid })
      .sort({ read: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      notifications: items.map((n) => ({
        _id: n._id,
        type: n.type,
        actorName: n.actorName,
        postId: n.postId ? String(n.postId) : null,
        commentId: n.commentId ? String(n.commentId) : null,
        meta: n.meta || {},
        read: n.read,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/community/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const n = await CommunityNotification.findById(req.params.id);
    if (!n || n.recipientFirebaseUid !== currentUserFirebaseUid) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    n.read = true;
    await n.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/community/notifications/read-all
export const markAllNotificationsRead = async (req, res) => {
  try {
    const currentUserFirebaseUid = getFirebaseUid(req.user);
    if (!currentUserFirebaseUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const result = await CommunityNotification.updateMany(
      { recipientFirebaseUid: currentUserFirebaseUid, read: false },
      { $set: { read: true } },
    );

    res.json({ success: true, modifiedCount: result.modifiedCount ?? 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/community/search — alias for posts with q (and optional filters)
export const communitySearch = async (req, res) => {
  req.query.sort = req.query.sort || 'feed';
  return getPosts(req, res);
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

