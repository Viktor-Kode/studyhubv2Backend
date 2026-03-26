import { customAlphabet } from 'nanoid';
import StudyGroup from '../models/StudyGroup.js';
import GroupMessage from '../models/GroupMessage.js';
import User from '../models/User.js';
import { hasActivePaidStudentPlan } from '../utils/studentSubscription.js';

const genJoinCode = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

function getFirebaseUid(reqUser) {
  return reqUser?.firebaseUid || reqUser?.uid || null;
}

function isPaid(user) {
  return hasActivePaidStudentPlan(user);
}

async function generateUniqueJoinCode() {
  for (let i = 0; i < 8; i++) {
    const code = genJoinCode();
    const exists = await StudyGroup.findOne({ joinCode: code }).select('_id').lean();
    if (!exists) return code;
  }
  return genJoinCode() + genJoinCode().slice(0, 2);
}

// ── GROUPS ────────────────────────────────────────────

export const getGroups = async (req, res) => {
  const { tab = 'my', subject } = req.query;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let query = {};
    if (tab === 'my') {
      query = { 'members.userId': userId };
    } else {
      query = { visibility: 'public', 'members.userId': { $ne: userId } };
      if (subject) query.subject = subject;
    }
    let groups = await StudyGroup.find(query)
      .sort(tab === 'my' ? { lastActivity: -1 } : { membersCount: -1 })
      .limit(20)
      .lean();

    if (tab === 'discover') {
      groups = groups.map((g) => {
        const { joinCode: _jc, ...rest } = g;
        return rest;
      });
    }

    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createGroup = async (req, res) => {
  const { name, description, subject, visibility, coverColor } = req.body;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existingGroups = await StudyGroup.countDocuments({ creatorId: userId });
    if (!isPaid(user) && existingGroups >= 1) {
      return res.status(403).json({
        error: 'Free plan allows 1 group with up to 2 members. Upgrade to create unlimited groups.',
      });
    }

    const joinCode = await generateUniqueJoinCode();
    const groupName = String(name || '').trim();
    if (!groupName) return res.status(400).json({ error: 'Group name is required' });

    const group = new StudyGroup({
      name: groupName.slice(0, 60),
      description: description != null ? String(description).slice(0, 300) : '',
      subject: subject || undefined,
      visibility: visibility === 'private' ? 'private' : 'public',
      coverColor: coverColor || '#5B4CF5',
      joinCode,
      creatorId: userId,
      creatorName: user.name,
      members: [
        {
          userId,
          name: user.name,
          role: 'admin',
          joinedAt: new Date(),
          points: 0,
        },
      ],
      membersCount: 1,
    });
    await group.save();

    await GroupMessage.create({
      groupId: group._id,
      authorId: 'system',
      authorName: 'System',
      content: `${user.name} created this group`,
      type: 'system',
    });

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const joinGroup = async (req, res) => {
  const { joinCode, groupId } = req.body;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const group = joinCode
      ? await StudyGroup.findOne({ joinCode: String(joinCode).trim().toUpperCase() })
      : await StudyGroup.findById(groupId);

    if (!group) return res.status(404).json({ error: 'Group not found. Check the join code.' });

    if (group.members.some((m) => m.userId === userId)) {
      return res.status(400).json({ error: 'You are already in this group.' });
    }

    const creator = await User.findOne({ firebaseUid: group.creatorId });
    if (!isPaid(creator) && group.membersCount >= 2) {
      return res.status(403).json({
        error: 'This group is full. The group creator needs to upgrade to add more members.',
      });
    }

    group.members.push({ userId, name: user.name, role: 'member', points: 0 });
    group.membersCount = group.members.length;
    group.lastActivity = new Date();
    await group.save();

    await GroupMessage.create({
      groupId: group._id,
      authorId: 'system',
      authorName: 'System',
      content: `${user.name} joined the group`,
      type: 'system',
    });

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getStudyGroup = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const group = await StudyGroup.findById(id).lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const isMember = group.members?.some((m) => m.userId === userId);
    if (!isMember && group.visibility !== 'public') {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (!isMember) {
      return res.json({
        ...group,
        joinCode: undefined,
        members: (group.members || []).slice(0, 8).map((m) => ({ ...m, points: undefined })),
      });
    }

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const leaveGroup = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const user = await User.findById(req.user._id);
    const displayName = user?.name || 'A member';

    const wasMember = group.members.some((m) => m.userId === userId);
    if (!wasMember) return res.status(403).json({ error: 'Not a member of this group' });

    group.members = group.members.filter((m) => m.userId !== userId);
    group.membersCount = group.members.length;

    if (group.creatorId === userId && group.members.length > 0) {
      group.members[0].role = 'admin';
      group.creatorId = group.members[0].userId;
      group.creatorName = group.members[0].name;
    }

    if (group.members.length === 0) {
      await StudyGroup.findByIdAndDelete(id);
      await GroupMessage.deleteMany({ groupId: id });
      return res.json({ deleted: true });
    }

    await group.save();
    await GroupMessage.create({
      groupId: id,
      authorId: 'system',
      authorName: 'System',
      content: `${displayName} left the group`,
      type: 'system',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── MESSAGES ─────────────────────────────────────────

export const getMessages = async (req, res) => {
  const { id } = req.params;
  const { before, limit = 50 } = req.query;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const query = { groupId: id };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await GroupMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(String(limit), 10) || 50)
      .lean();

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const sendMessage = async (req, res) => {
  const { id } = req.params;
  const { content, replyTo } = req.body;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const text = String(content || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is required' });
  if (text.length > 1000) return res.status(400).json({ error: 'Message too long' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let replyPayload;
    if (replyTo && replyTo.messageId) {
      replyPayload = {
        messageId: replyTo.messageId,
        authorName: replyTo.authorName || 'User',
        preview: String(replyTo.preview || '').slice(0, 60),
      };
    }

    const message = await GroupMessage.create({
      groupId: id,
      authorId: userId,
      authorName: user.name,
      content: text,
      type: 'text',
      ...(replyPayload ? { replyTo: replyPayload } : {}),
    });

    await StudyGroup.findByIdAndUpdate(id, {
      lastActivity: new Date(),
      $inc: { messagesCount: 1 },
    });

    await StudyGroup.findOneAndUpdate({ _id: id, 'members.userId': userId }, { $inc: { 'members.$.points': 1 } });

    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const toggleMessageReaction = async (req, res) => {
  const { id, messageId } = req.params;
  const { emoji } = req.body;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!emoji || typeof emoji !== 'string') return res.status(400).json({ error: 'emoji required' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const msg = await GroupMessage.findOne({ _id: messageId, groupId: id });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.isDeleted) return res.status(400).json({ error: 'Cannot react to a deleted message' });

    const reactions = msg.reactions || [];
    const idx = reactions.findIndex((r) => r.emoji === emoji);
    if (idx === -1) {
      reactions.push({ emoji, users: [userId] });
    } else {
      const users = reactions[idx].users || [];
      if (users.includes(userId)) {
        reactions[idx].users = users.filter((u) => u !== userId);
        if (reactions[idx].users.length === 0) reactions.splice(idx, 1);
      } else {
        reactions[idx].users = [...users, userId];
      }
    }
    msg.reactions = reactions;
    await msg.save();
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getGroupUpdates = async (req, res) => {
  const { id } = req.params;
  const { since } = req.query;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const sinceDate = since ? new Date(since) : new Date(Date.now() - 15000);

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const newMessages = await GroupMessage.find({
      groupId: id,
      createdAt: { $gt: sinceDate },
    })
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      newMessages,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const askGroupAI = async (req, res) => {
  const { id } = req.params;
  const { question, subject } = req.body;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const q = String(question || '').trim();
  if (!q) return res.status(400).json({ error: 'Question is required' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await GroupMessage.create({
      groupId: id,
      authorId: userId,
      authorName: user.name,
      content: q,
      type: 'text',
    });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI is not configured' });
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI tutor in a Nigerian student study group. Subject focus: ${subject || group.subject || 'General'}. Give clear, concise answers suitable for secondary school and university students. Use examples relevant to Nigeria where possible.`,
          },
          { role: 'user', content: q },
        ],
        max_tokens: 400,
      }),
    });

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return res.status(502).json({ error: data?.error?.message || 'AI did not return an answer' });
    }

    const MAX_AI_CHARS = 12000;
    const aiContent =
      answer.length > MAX_AI_CHARS
        ? `${answer.slice(0, MAX_AI_CHARS - 30)}\n\n…(truncated)`
        : answer;

    const aiMessage = await GroupMessage.create({
      groupId: id,
      authorId: 'ai',
      authorName: 'StudyHelp AI',
      content: aiContent,
      type: 'ai',
    });

    await StudyGroup.findByIdAndUpdate(id, {
      lastActivity: new Date(),
      $inc: { messagesCount: 2 },
    });

    await StudyGroup.findOneAndUpdate({ _id: id, 'members.userId': userId }, { $inc: { 'members.$.points': 5 } });

    res.json({ message: aiMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const EDIT_WINDOW_MS = 5 * 60 * 1000;

export const editMessage = async (req, res) => {
  const { id, messageId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const text = String(req.body.content || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is required' });
  if (text.length > 1000) return res.status(400).json({ error: 'Message too long' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const msg = await GroupMessage.findOne({ _id: messageId, groupId: id });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.authorId !== userId) return res.status(403).json({ error: 'You can only edit your own messages' });
    if (msg.type !== 'text') return res.status(400).json({ error: 'This message cannot be edited' });
    if (msg.isDeleted) return res.status(400).json({ error: 'Message was deleted' });
    if (msg.editedAt) return res.status(400).json({ error: 'This message was already edited' });

    const age = Date.now() - new Date(msg.createdAt).getTime();
    if (age > EDIT_WINDOW_MS) {
      return res.status(403).json({ error: 'Edit window expired (5 minutes)' });
    }

    msg.content = text;
    msg.editedAt = new Date();
    await msg.save();
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteMessage = async (req, res) => {
  const { id, messageId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const msg = await GroupMessage.findOne({ _id: messageId, groupId: id });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.authorId !== userId) return res.status(403).json({ error: 'You can only delete your own messages' });
    if (msg.type !== 'text') return res.status(400).json({ error: 'This message cannot be deleted' });
    if (msg.isDeleted) return res.status(400).json({ error: 'Message already deleted' });

    msg.isDeleted = true;
    msg.deletedAt = new Date();
    msg.content = ' ';
    msg.reactions = [];
    await msg.save();
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const markMessagesRead = async (req, res) => {
  const { id } = req.params;
  const { lastReadAt } = req.body || {};
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const cutoff = new Date(lastReadAt);
  if (!lastReadAt || Number.isNaN(cutoff.getTime())) {
    return res.status(400).json({ error: 'lastReadAt must be a valid ISO date string' });
  }

  try {
    const group = await StudyGroup.findById(id);
    if (!group || !group.members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const lr = group.lastRead || [];
    const idx = lr.findIndex((r) => r.userId === userId);
    if (idx >= 0) {
      if (new Date(lr[idx].lastReadAt) < cutoff) lr[idx].lastReadAt = cutoff;
    } else {
      lr.push({ userId, lastReadAt: cutoff });
    }
    group.lastRead = lr;
    await group.save();

    await GroupMessage.updateMany(
      {
        groupId: id,
        createdAt: { $lte: cutoff },
        authorId: { $ne: userId },
        isDeleted: { $ne: true },
        type: { $in: ['text', 'ai'] },
      },
      { $addToSet: { seenBy: userId } },
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
