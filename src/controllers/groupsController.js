import cloudinary from '../config/cloudinary.js';
import Group from '../models/Group.js';
import GroupMembership from '../models/GroupMembership.js';
import GroupPost from '../models/GroupPost.js';
import GroupComment from '../models/GroupComment.js';
import GroupResource from '../models/GroupResource.js';
import GroupChatMessage from '../models/GroupChatMessage.js';
import GroupStudySession from '../models/GroupStudySession.js';
import GroupTodo from '../models/GroupTodo.js';
import GroupNotification from '../models/GroupNotification.js';
import User from '../models/User.js';
import { nanoid } from 'nanoid';
import { resolveMentionNamesInComment } from '../services/communityEngagementService.js';

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
  return reqUser?.firebaseUid || reqUser?.uid || reqUser?._id?.toString?.() || null;
}

function rankTierFromPoints(totalPoints) {
  const n = Number(totalPoints) || 0;
  if (n >= 2000) return 'Campus Champion';
  if (n >= 1000) return 'Top Scholar';
  if (n >= 500) return 'Serious Scholar';
  if (n >= 200) return 'Active Learner';
  return 'Beginner';
}

function normalizePostForClient(post, currentUserFirebaseUid, authorMeta = null) {
  const likes = post.likes || [];
  const likesCount = likes.length;
  const isLiked = !!currentUserFirebaseUid && likes.includes(currentUserFirebaseUid);
  const commentsCount = post.commentsCount || 0;
  const pid = post._id ? String(post._id) : '';

  // Avoid leaking full likes arrays
  const { likes: _likes, ...rest } = post;

  return {
    ...rest,
    _id: pid,
    isLiked,
    likesCount,
    commentsCount,
    bestAnswerCommentId: post.bestAnswerCommentId ? String(post.bestAnswerCommentId) : null,
    authorRole: authorMeta?.role || null,
    authorIsVerified: !!authorMeta?.isVerified,
  };
}

async function canAccessGroup(groupId, currentUid) {
  if (!groupId || !currentUid) return false;
  const m = await GroupMembership.findOne({ group: groupId, user: currentUid, status: 'active' }).lean();
  return !!m;
}

async function getMembership(groupId, currentUid) {
  if (!groupId || !currentUid) return null;
  return GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
}

async function requireGroupAccess(req, res) {
  const currentUid = getFirebaseUid(req.user);
  if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const { id } = req.params;
  const ok = await canAccessGroup(id, currentUid);
  if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

  return currentUid;
}

function requireAdminOrModerator(membership) {
  return membership?.role === 'admin' || membership?.role === 'moderator';
}

async function bumpUserCommunityPoints(userMongoId, delta) {
  if (!userMongoId) return;
  const user = await User.findById(userMongoId);
  if (!user) return;
  user.communityPoints = (user.communityPoints || 0) + delta;
  user.totalPoints = (user.communityPoints || 0) + (user.cbtPoints || 0);
  await user.save({ validateBeforeSave: false });
}

async function createGroupNotificationsForMembers({
  groupId,
  excludeUid = null,
  type,
  actorFirebaseUid = null,
  actorName = null,
  meta = {},
  postId = null,
  commentId = null,
  resourceId = null,
  sessionId = null,
  todoId = null,
  messageId = null,
  scheduledFor = null,
}) {
  const memberships = await GroupMembership.find({ group: groupId, status: 'active' }).select('user').lean();
  const recipients = (memberships || []).map((m) => m.user).filter((uid) => uid && uid !== excludeUid);
  if (!recipients.length) return;

  // Keep inserts bounded to avoid massive payloads.
  const maxRecipients = 150;
  const slice = recipients.slice(0, maxRecipients);

  await GroupNotification.insertMany(
    slice.map((recipientFirebaseUid) => ({
      group: groupId,
      recipientFirebaseUid,
      type,
      actorFirebaseUid,
      actorName,
      postId,
      commentId,
      resourceId,
      sessionId,
      todoId,
      messageId,
      meta,
      read: false,
      scheduledFor,
    }))
  );
}

export const getGroups = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const memberships = await GroupMembership.find({ user: currentUid, status: 'active' }).lean();
    const groupIds = memberships.map((m) => m.group);
    if (!groupIds.length) return res.json({ groups: [] });

    const roleByGroup = new Map(memberships.map((m) => [String(m.group), m.role]));

    const groups = await Group.find({ _id: { $in: groupIds } })
      .sort({ lastActiveAt: -1 })
      .lean();

    const counts = await GroupMembership.aggregate([
      { $match: { group: { $in: groupIds }, status: 'active' } },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]);
    const countByGroup = new Map((counts || []).map((x) => [String(x._id), x.count]));

    const normalized = groups.map((g) => ({
      _id: String(g._id),
      name: g.name,
      description: g.description,
      subject: g.subject,
      isPrivate: g.isPrivate,
      inviteCode: g.isPrivate ? g.inviteCode : null,
      bannerImage: g.bannerImage,
      createdBy: g.createdBy,
      createdAt: g.createdAt,
      lastActiveAt: g.lastActiveAt,
      myRole: roleByGroup.get(String(g._id)) || 'member',
      membersCount: countByGroup.get(String(g._id)) || 0,
      settings: g.settings || {},
    }));

    res.json({ success: true, groups: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, description, subject, isPrivate = false, settings = {}, bannerImage } = req.body || {};
    const trimmedName = String(name || '').trim();
    const trimmedSubject = String(subject || '').trim();
    if (!trimmedName) return res.status(400).json({ success: false, error: 'name is required' });
    if (!trimmedSubject) return res.status(400).json({ success: false, error: 'subject is required' });

    const requireApproval = typeof settings.requireApproval === 'boolean' ? settings.requireApproval : false;

    let inviteCode = null;
    if (isPrivate) inviteCode = nanoid(8).toUpperCase();

    const group = await Group.create({
      name: trimmedName,
      description: String(description || '').trim(),
      subject: trimmedSubject,
      isPrivate: !!isPrivate,
      inviteCode,
      bannerImage: bannerImage || null,
      createdBy: currentUid,
      lastActiveAt: new Date(),
      settings: {
        allowMemberPosts: typeof settings.allowMemberPosts === 'boolean' ? settings.allowMemberPosts : true,
        requireApproval,
      },
    });

    await GroupMembership.create({
      group: group._id,
      user: currentUid,
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
      lastReadAt: new Date(),
    });

    res.status(201).json({ success: true, groupId: String(group._id), group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const group = await Group.findById(groupId).lean();
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid, status: 'active' }).lean();
    if (!membership) return res.status(403).json({ success: false, error: 'Not a group member' });

    const membersMembership = await GroupMembership.find({ group: groupId, status: 'active' }).lean();
    const memberUids = membersMembership.map((m) => m.user);

    const users = await User.find({ firebaseUid: { $in: memberUids } })
      .select('firebaseUid name isVerified role')
      .lean();
    const userByUid = new Map((users || []).map((u) => [u.firebaseUid, u]));

    const members = membersMembership.map((m) => {
      const u = userByUid.get(m.user);
      return {
        userId: m.user,
        name: u?.name || 'Student',
        avatar: computeInitials(u?.name || 'Student'),
        role: m.role,
        joinedAt: m.joinedAt,
        lastReadAt: m.lastReadAt,
        isVerified: !!u?.isVerified,
      };
    });

    res.json({
      success: true,
      group: {
        _id: String(group._id),
        name: group.name,
        description: group.description,
        subject: group.subject,
        isPrivate: group.isPrivate,
        bannerImage: group.bannerImage,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        lastActiveAt: group.lastActiveAt,
        inviteCode: group.isPrivate ? group.inviteCode : null,
        settings: group.settings || {},
        myRole: membership.role,
        membersCount: members.length,
        members,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    const { name, description, subject, isPrivate, settings, bannerImage } = req.body || {};
    if (name !== undefined) group.name = String(name || '').trim();
    if (description !== undefined) group.description = String(description || '').trim();
    if (subject !== undefined) group.subject = String(subject || '').trim();
    if (bannerImage !== undefined) group.bannerImage = bannerImage || null;

    if (isPrivate !== undefined) {
      const nextPrivate = !!isPrivate;
      group.isPrivate = nextPrivate;
      if (nextPrivate && !group.inviteCode) group.inviteCode = nanoid(8).toUpperCase();
      if (!nextPrivate) group.inviteCode = null;
    }

    if (settings && typeof settings === 'object') {
      if (typeof settings.allowMemberPosts === 'boolean') group.settings.allowMemberPosts = settings.allowMemberPosts;
      if (typeof settings.requireApproval === 'boolean') group.settings.requireApproval = settings.requireApproval;
    }

    await group.save();
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const postIds = await GroupPost.find({ group: groupId }).select('_id').lean().then((rows) => rows.map((r) => r._id));

    await Promise.all([
      GroupMembership.deleteMany({ group: groupId }),
      GroupPost.deleteMany({ group: groupId }),
      GroupComment.deleteMany({ postId: { $in: postIds } }).catch(() => {}),
      GroupResource.deleteMany({ group: groupId }),
      GroupChatMessage.deleteMany({ group: groupId }),
      GroupStudySession.deleteMany({ group: groupId }),
      GroupTodo.deleteMany({ group: groupId }),
      GroupNotification.deleteMany({ group: groupId }),
      Group.deleteOne({ _id: groupId }),
    ]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const generateInvite = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    if (!group.isPrivate) {
      return res.status(400).json({ success: false, error: 'Cannot invite a public group' });
    }

    group.inviteCode = group.inviteCode || nanoid(8).toUpperCase();
    await group.save();

    const origin = req.get('origin') || '';
    const inviteLink = origin ? `${origin}/groups/join?code=${encodeURIComponent(group.inviteCode)}` : null;

    res.json({ success: true, inviteCode: group.inviteCode, inviteLink });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const joinGroup = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const group = await Group.findById(groupId).lean();
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    // Public group => join without code
    const body = req.body || {};
    const inviteCode = body.inviteCode ? String(body.inviteCode).trim().toUpperCase() : null;

    if (group.isPrivate) {
      if (!inviteCode || inviteCode !== String(group.inviteCode)) {
        return res.status(403).json({ success: false, error: 'Invalid invite code' });
      }
    }

    const existing = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (existing?.status === 'active') return res.json({ success: true, membership: existing });

    const nextStatus = group.settings?.requireApproval ? 'pending' : 'active';
    const membership = await GroupMembership.create({
      group: groupId,
      user: currentUid,
      role: 'member',
      status: nextStatus,
    });

    res.status(201).json({ success: true, membership });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const addGroupMember = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });

    const { userId, role = 'member' } = req.body || {};
    const targetUid = String(userId || '').trim();
    if (!targetUid) return res.status(400).json({ success: false, error: 'userId is required' });

    const target = await User.findOne({ firebaseUid: targetUid }).lean();
    if (!target) return res.status(404).json({ success: false, error: 'User not found' });

    const existing = await GroupMembership.findOne({ group: groupId, user: targetUid }).lean();
    if (existing) {
      await GroupMembership.updateOne({ group: groupId, user: targetUid }, { $set: { role, status: 'active' } });
      return res.json({ success: true, membership: { ...existing, role } });
    }

    const next = await GroupMembership.create({
      group: groupId,
      user: targetUid,
      role,
      status: 'active',
      joinedAt: new Date(),
      lastReadAt: new Date(),
    });

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });
    res.status(201).json({ success: true, membership: next });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateMemberRole = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const targetUserId = String(req.params.userId || '').trim();
    const body = req.body || {};
    const role = body.role ? String(body.role).trim() : null;
    if (!role) return res.status(400).json({ success: false, error: 'role is required' });

    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });

    const updated = await GroupMembership.findOneAndUpdate(
      { group: groupId, user: targetUserId },
      { $set: { role, status: 'active' } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, error: 'Membership not found' });

    res.json({ success: true, membership: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const removeGroupMember = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const targetUserId = String(req.params.userId || '').trim();

    const membership = await GroupMembership.findOne({ group: groupId, user: currentUid }).lean();
    if (!membership || membership.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });

    if (targetUserId === currentUid) {
      return res.status(400).json({ success: false, error: 'You cannot remove yourself' });
    }

    await GroupMembership.deleteOne({ group: groupId, user: targetUserId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroupPosts = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10), 10) || 10));
    const sort = String(req.query.sort || 'newest').toLowerCase();

    let query = { group: groupId };

    // If needed later, we can filter by subject.
    const match = { ...query };

    let totalPosts = 0;
    let posts = [];

    if (sort === 'trending') {
      totalPosts = await GroupPost.countDocuments(match);
      posts = await GroupPost.find(match)
        .sort({ isPinned: -1, createdAt: -1 })
        .lean();

      posts = posts
        .map((p) => ({
          p,
          s: (p.likes?.length || 0) + 2 * (p.commentsCount || 0),
        }))
        .sort((a, b) => b.s - a.s)
        .slice((page - 1) * limit, page * limit)
        .map((x) => x.p);
    } else {
      totalPosts = await GroupPost.countDocuments(match);
      posts = await GroupPost.find(match)
        .sort({ isPinned: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    }

    const authorIds = Array.from(new Set(posts.map((p) => p.authorId).filter(Boolean)));
    const users = await User.find({ firebaseUid: { $in: authorIds } })
      .select('firebaseUid role isVerified totalPoints name')
      .lean();
    const authorMap = new Map(users.map((u) => [u.firebaseUid, { role: u.role, isVerified: u.isVerified, totalPoints: u.totalPoints }]));

    const normalized = posts.map((p) => {
      const authorMeta = authorMap.get(p.authorId) || null;
      return normalizePostForClient(p, currentUid, authorMeta);
    });

    const totalPages = Math.max(1, Math.ceil(totalPosts / limit));

    res.json({ success: true, posts: normalized, page, limit, totalPages, totalPosts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createGroupPost = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await getMembership(groupId, currentUid);
    if (!membership || membership.status !== 'active') return res.status(403).json({ success: false, error: 'Not a group member' });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    if (!group.settings?.allowMemberPosts && !requireAdminOrModerator(membership)) {
      return res.status(403).json({ success: false, error: 'Posting disabled by group settings' });
    }

    const body = req.body || {};
    const content = String(body.content || '').trim();
    const type = body.type ? String(body.type) : 'post';
    const subject = body.subject !== undefined ? String(body.subject || '').trim() : group.subject;

    if (!content) return res.status(400).json({ success: false, error: 'content is required' });
    if (content.length > 1000) return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });

    const authorName = req.user?.name || 'Student';
    const authorAvatar = computeInitials(authorName);

    const postData = {
      group: groupId,
      authorId: currentUid,
      authorName,
      authorAvatar,
      content,
      subject: subject || null,
      type,
      likes: [],
      commentsCount: 0,
      views: 0,
      isPinned: false,
      bestAnswerCommentId: null,
      poll: undefined,
      resource: undefined,
    };

    if (type === 'resource') {
      const resource = body.resource || {};
      const rType = String(resource.type || '').trim();
      const url = resource.url ? String(resource.url).trim() : '';
      const title = resource.title ? String(resource.title).trim() : null;
      if (!rType || !['file', 'link'].includes(rType)) return res.status(400).json({ success: false, error: 'resource.type must be file|link' });
      if (!url) return res.status(400).json({ success: false, error: 'resource.url is required' });
      postData.resource = { type: rType, url, title };
    }

    if (type === 'poll') {
      const poll = body.poll || {};
      const question = poll.question ? String(poll.question).trim() : '';
      const endsAt = poll.endsAt ? new Date(poll.endsAt) : null;
      const optionsRaw = Array.isArray(poll.options) ? poll.options : [];
      const options = optionsRaw
        .map((o) => ({ text: String(o?.text || '').trim() }))
        .filter((o) => o.text.length > 0)
        .slice(0, 4)
        .map((o) => ({ text: o.text, votes: [] }));

      if (!question) return res.status(400).json({ success: false, error: 'poll.question is required' });
      if (!endsAt || Number.isNaN(endsAt.getTime())) return res.status(400).json({ success: false, error: 'poll.endsAt is required' });
      if (options.length < 2) return res.status(400).json({ success: false, error: 'poll.options needs at least 2 options' });

      postData.poll = { question, options, endsAt };
    }

    const post = await GroupPost.create(postData);

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });
    await bumpUserCommunityPoints(req.user._id, 5);

    // Notify group members (excluding author)
    await createGroupNotificationsForMembers({
      groupId,
      excludeUid: currentUid,
      type: 'post',
      actorFirebaseUid: currentUid,
      actorName: authorName,
      postId: post._id,
    });

    const authorMeta = { role: req.user.role || null, isVerified: !!req.user.isVerified };
    const normalized = normalizePostForClient(post.toObject(), currentUid, authorMeta);
    res.status(201).json({ success: true, post: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const likeGroupPost = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const groupPostId = req.params.postId;

    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const post = await GroupPost.findOne({ _id: groupPostId, group: groupId });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const likes = post.likes || [];
    const alreadyLiked = likes.includes(currentUid);
    post.likes = alreadyLiked ? likes.filter((uid) => uid !== currentUid) : [...likes, currentUid];
    await post.save();

    res.json({
      success: true,
      liked: !alreadyLiked,
      likesCount: post.likes.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroupPostComments = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const postId = req.params.postId;

    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const comments = await GroupComment.find({ postId, parentId: null })
      .sort({ createdAt: 1 })
      .lean();

    const children = await GroupComment.find({ postId, parentId: { $ne: null } })
      .sort({ createdAt: 1 })
      .lean();

    const all = [...comments, ...children].map((c) => ({
      _id: String(c._id),
      postId: String(c.postId),
      parentId: c.parentId ? String(c.parentId) : null,
      authorId: c.authorId,
      authorName: c.authorName,
      authorAvatar: c.authorAvatar || null,
      content: c.content,
      createdAt: c.createdAt,
      likesCount: (c.likes || []).length,
      isLiked: !!c.likes?.includes?.(currentUid),
    }));

    // Frontend can reconstruct tree using parentId.
    res.json({ success: true, comments: all });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const addGroupPostComment = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const postId = req.params.postId;

    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const body = req.body || {};
    const content = String(body.content || '').trim();
    const parentIdRaw = body.parentId === undefined ? null : body.parentId;
    const parentId =
      parentIdRaw === null || parentIdRaw === '' || String(parentIdRaw).toLowerCase() === 'null'
        ? null
        : String(parentIdRaw);

    if (!content) return res.status(400).json({ success: false, error: 'content is required' });
    if (content.length > 500) return res.status(400).json({ success: false, error: 'content exceeds 500 characters' });

    const post = await GroupPost.findOne({ _id: postId, group: groupId }).lean();
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const authorName = req.user?.name || 'Student';
    const authorAvatar = computeInitials(authorName);
    const mentionedFirebaseUids = await resolveMentionNamesInComment(content);

    if (parentId) {
      const parent = await GroupComment.findOne({ _id: parentId, postId }).lean();
      if (!parent) return res.status(404).json({ success: false, error: 'Parent comment not found' });
    }

    const comment = await GroupComment.create({
      postId,
      parentId: parentId || null,
      authorId: currentUid,
      authorName,
      authorAvatar,
      content,
      mentionedFirebaseUids,
      likes: [],
    });

    await GroupPost.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });
    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });
    await bumpUserCommunityPoints(req.user._id, 3);

    // Notify post author and mentions
    const actorName = authorName;
    if (post.authorId !== currentUid) {
      await GroupNotification.create({
        group: groupId,
        recipientFirebaseUid: post.authorId,
        type: 'comment',
        actorFirebaseUid: currentUid,
        actorName,
        postId,
        commentId: comment._id,
        meta: {},
        read: false,
      });
    }

    for (const uid of mentionedFirebaseUids || []) {
      if (uid === currentUid) continue;
      await GroupNotification.create({
        group: groupId,
        recipientFirebaseUid: uid,
        type: 'mention',
        actorFirebaseUid: currentUid,
        actorName,
        postId,
        commentId: comment._id,
        meta: {},
        read: false,
      });
    }

    res.status(201).json({
      success: true,
      comment: {
        _id: String(comment._id),
        postId: String(comment.postId),
        parentId: comment.parentId ? String(comment.parentId) : null,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorAvatar: comment.authorAvatar || null,
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

export const getGroupResources = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const resources = await GroupResource.find({ group: groupId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ success: true, resources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const uploadGroupResource = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    const membership = await getMembership(groupId, currentUid);

    if (!group.settings?.allowMemberPosts && !requireAdminOrModerator(membership)) {
      return res.status(403).json({ success: false, error: 'Uploading disabled by group settings' });
    }

    const body = req.body || {};
    const type = body.type ? String(body.type) : null;

    const title = body.title ? String(body.title).trim() : null;
    const description = body.description ? String(body.description).trim() : '';

    let resourceType;
    let url;

    if (type === 'file') {
      if (!req.file) return res.status(400).json({ success: false, error: 'file is required for type=file' });
      resourceType = 'file';

      const base64 = req.file.buffer.toString('base64');
      const dataUri = `data:${req.file.mimetype};base64,${base64}`;
      const uploadRes = await cloudinary.uploader.upload(dataUri, {
        resource_type: 'auto',
        folder: 'studyhelp/groups',
        access_mode: 'public',
      });
      url = uploadRes.secure_url;
    } else if (type === 'link') {
      resourceType = 'link';
      url = body.url ? String(body.url).trim() : '';
      if (!url) return res.status(400).json({ success: false, error: 'url is required for type=link' });
    } else {
      return res.status(400).json({ success: false, error: 'type must be file|link' });
    }

    const finalTitle = title || (req.file?.originalname ? req.file.originalname.replace(/\.[^/.]+$/, '') : null) || 'Resource';

    const resource = await GroupResource.create({
      group: groupId,
      title: finalTitle,
      description,
      type: resourceType,
      url,
      uploadedBy: currentUid,
    });

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });
    await bumpUserCommunityPoints(req.user._id, 5);

    await createGroupNotificationsForMembers({
      groupId,
      excludeUid: currentUid,
      type: 'resource',
      actorFirebaseUid: currentUid,
      actorName: req.user?.name || 'Student',
      resourceId: resource._id,
    });

    res.status(201).json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroupChat = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || 30), 10) || 30));

    const messages = await GroupChatMessage.find({ group: groupId })
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const messageIds = messages.map((m) => m._id).filter(Boolean);
    if (messageIds.length) {
      await GroupChatMessage.updateMany(
        { _id: { $in: messageIds }, group: groupId },
        { $addToSet: { readBy: currentUid } }
      );
    }

    const normalized = messages.map((m) => ({
      _id: String(m._id),
      group: String(m.group),
      sender: m.sender,
      senderName: m.senderName,
      senderAvatar: m.senderAvatar || null,
      content: m.content,
      createdAt: m.createdAt,
      readByCount: (m.readBy || []).length,
      isReadByMe: (m.readBy || []).includes(currentUid),
    }));

    res.json({ success: true, messages: normalized, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const sendGroupChatMessage = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const body = req.body || {};
    const content = String(body.content || '').trim();
    if (!content) return res.status(400).json({ success: false, error: 'content is required' });
    if (content.length > 1000) return res.status(400).json({ success: false, error: 'content exceeds 1000 characters' });

    const authorName = req.user?.name || 'Student';
    const authorAvatar = computeInitials(authorName);
    const mentionedFirebaseUids = await resolveMentionNamesInComment(content);

    const message = await GroupChatMessage.create({
      group: groupId,
      sender: currentUid,
      senderName: authorName,
      senderAvatar: authorAvatar,
      content,
      readBy: [currentUid],
    });

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });

    // Notify mentions in chat
    for (const uid of mentionedFirebaseUids || []) {
      if (uid === currentUid) continue;
      await GroupNotification.create({
        group: groupId,
        recipientFirebaseUid: uid,
        type: 'chat_mention',
        actorFirebaseUid: currentUid,
        actorName: authorName,
        messageId: message._id,
        meta: {},
        read: false,
      });
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroupSessions = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const sessions = await GroupStudySession.find({ group: groupId })
      .sort({ startTime: 1 })
      .limit(100)
      .lean();

    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createGroupSession = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'title is required' });

    const startTime = body.startTime ? new Date(body.startTime) : null;
    if (!startTime || Number.isNaN(startTime.getTime())) return res.status(400).json({ success: false, error: 'startTime is required' });

    const endTime = body.endTime ? new Date(body.endTime) : null;
    const meetingLink = body.meetingLink ? String(body.meetingLink).trim() : null;

    const session = await GroupStudySession.create({
      group: groupId,
      title,
      startTime,
      endTime: endTime && !Number.isNaN(endTime.getTime()) ? endTime : null,
      meetingLink,
      createdBy: currentUid,
      attendees: [currentUid],
    });

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });
    await bumpUserCommunityPoints(req.user._id, 3);

    // Immediate "upcoming session" notifications (can be refined with a cron later)
    await createGroupNotificationsForMembers({
      groupId,
      excludeUid: currentUid,
      type: 'session',
      actorFirebaseUid: currentUid,
      actorName: req.user?.name || 'Student',
      sessionId: session._id,
      scheduledFor: startTime,
      meta: { startTime: startTime.toISOString() },
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const rsvpGroupSession = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const sessionId = req.params.sessionId;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const body = req.body || {};
    const attending = body.attending === undefined ? true : !!body.attending;

    const session = await GroupStudySession.findOne({ _id: sessionId, group: groupId });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    if (attending) {
      if (!session.attendees.includes(currentUid)) session.attendees.push(currentUid);
    } else {
      session.attendees = session.attendees.filter((uid) => uid !== currentUid);
    }
    await session.save();

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getGroupTodos = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const ok = await canAccessGroup(groupId, currentUid);
    if (!ok) return res.status(403).json({ success: false, error: 'Not a group member' });

    const todos = await GroupTodo.find({ group: groupId })
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ success: true, todos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createGroupTodo = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const membership = await getMembership(groupId, currentUid);
    if (!membership || !requireAdminOrModerator(membership)) return res.status(403).json({ success: false, error: 'Admin/moderator only' });

    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'title is required' });

    const description = String(body.description || '').trim();
    const assignedTo = body.assignedTo ? String(body.assignedTo).trim() : null;
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const dueValid = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;

    const todo = await GroupTodo.create({
      group: groupId,
      title,
      description,
      completed: false,
      assignedTo: assignedTo || null,
      createdBy: currentUid,
      dueDate: dueValid,
    });

    await Group.findByIdAndUpdate(groupId, { $set: { lastActiveAt: new Date() } });

    if (assignedTo) {
      await GroupNotification.create({
        group: groupId,
        recipientFirebaseUid: assignedTo,
        type: 'todo',
        actorFirebaseUid: currentUid,
        actorName: req.user?.name || 'Student',
        todoId: todo._id,
        meta: {},
        read: false,
      });
    }

    res.status(201).json({ success: true, todo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateGroupTodo = async (req, res) => {
  try {
    const currentUid = getFirebaseUid(req.user);
    if (!currentUid) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const groupId = req.params.id;
    const todoId = req.params.todoId;
    const membership = await getMembership(groupId, currentUid);
    if (!membership || !requireAdminOrModerator(membership)) return res.status(403).json({ success: false, error: 'Admin/moderator only' });

    const body = req.body || {};
    const completed = body.completed !== undefined ? !!body.completed : undefined;
    const assignedTo = body.assignedTo !== undefined ? (body.assignedTo ? String(body.assignedTo).trim() : null) : undefined;
    const dueDate = body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined;
    const description = body.description !== undefined ? String(body.description || '').trim() : undefined;

    const dueValid =
      dueDate instanceof Date && !Number.isNaN(dueDate.getTime())
        ? dueDate
        : dueDate === null
          ? null
          : undefined;

    const updates = {};
    if (completed !== undefined) updates.completed = completed;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (dueValid !== undefined) updates.dueDate = dueValid;
    if (description !== undefined) updates.description = description;

    const updated = await GroupTodo.findOneAndUpdate({ _id: todoId, group: groupId }, { $set: updates }, { new: true }).lean();
    if (!updated) return res.status(404).json({ success: false, error: 'Todo not found' });

    if (assignedTo) {
      await GroupNotification.create({
        group: groupId,
        recipientFirebaseUid: assignedTo,
        type: 'todo',
        actorFirebaseUid: currentUid,
        actorName: req.user?.name || 'Student',
        todoId: todoId,
        meta: { updated: true },
        read: false,
      });
    }

    res.json({ success: true, todo: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

