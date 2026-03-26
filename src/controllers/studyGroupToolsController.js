import StudyGroup from '../models/StudyGroup.js';
import GroupGoal from '../models/GroupGoal.js';
import GroupTopic from '../models/GroupTopic.js';
import GroupQuiz from '../models/GroupQuiz.js';
import GroupWhiteboard from '../models/GroupWhiteboard.js';

function getFirebaseUid(reqUser) {
  return reqUser?.firebaseUid || reqUser?.uid || null;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function addMemberPoints(groupId, userId, amount) {
  if (!userId || amount === 0) return;
  await StudyGroup.findOneAndUpdate(
    { _id: groupId, 'members.userId': userId },
    { $inc: { 'members.$.points': amount } },
  );
}

async function loadGroupForUser(id, userId) {
  const group = await StudyGroup.findById(id).lean();
  if (!group) return { error: 'Group not found', status: 404, group: null };
  const member = group.members.find((m) => m.userId === userId);
  if (!member) return { error: 'Not a member', status: 403, group: null };
  return { group, member, error: null, status: null };
}

function isGroupAdmin(group, userId) {
  const m = group.members.find((x) => x.userId === userId);
  return Boolean(m?.role === 'admin' || group.creatorId === userId);
}

// ── Goals ─────────────────────────────────────────

export const listGoals = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const goals = await GroupGoal.find({ groupId: id }).sort({ dueDate: 1, createdAt: -1 }).lean();
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createGoal = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const goal = await GroupGoal.create({
      groupId: id,
      title: title.slice(0, 200),
      description: String(req.body.description || '').slice(0, 2000),
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
      createdBy: userId,
    });
    await addMemberPoints(id, userId, 2);
    res.json(goal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateGoal = async (req, res) => {
  const { id, goalId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const goal = await GroupGoal.findOne({ _id: goalId, groupId: id });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const admin = isGroupAdmin(group, userId);
    const isCreator = goal.createdBy === userId;
    const body = req.body || {};

    if (typeof body.completed === 'boolean') {
      if (!isCreator && !admin) return res.status(403).json({ error: 'Only the goal creator or an admin can complete this' });
      if (body.completed && !goal.completed) {
        goal.completed = true;
        goal.completedBy = userId;
        await goal.save();
        await addMemberPoints(id, userId, 5);
        return res.json(goal);
      }
      if (!body.completed && goal.completed) {
        if (!isCreator && !admin) return res.status(403).json({ error: 'Forbidden' });
        goal.completed = false;
        goal.completedBy = undefined;
        await goal.save();
        return res.json(goal);
      }
    }

    if (body.title != null || body.description != null || body.dueDate !== undefined) {
      if (!isCreator && !admin) return res.status(403).json({ error: 'Only the creator or admin can edit' });
      if (body.title != null) goal.title = String(body.title).trim().slice(0, 200);
      if (body.description != null) goal.description = String(body.description).slice(0, 2000);
      if (body.dueDate !== undefined) {
        goal.dueDate = body.dueDate ? new Date(body.dueDate) : undefined;
      }
      await goal.save();
    }
    res.json(goal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteGoal = async (req, res) => {
  const { id, goalId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const goal = await GroupGoal.findOne({ _id: goalId, groupId: id });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (goal.createdBy !== userId && !isGroupAdmin(group, userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await goal.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Topics ─────────────────────────────────────────

export const listTopics = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const topics = await GroupTopic.find({ groupId: id }).sort({ createdAt: -1 }).lean();
    res.json(topics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createTopic = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const topic = String(req.body.topic || '').trim();
  if (!topic) return res.status(400).json({ error: 'Topic is required' });
  let assignedTo = req.body.assignedTo ? String(req.body.assignedTo) : undefined;
  if (assignedTo && !group.members.some((m) => m.userId === assignedTo)) {
    return res.status(400).json({ error: 'Assignee is not a group member' });
  }
  try {
    const doc = await GroupTopic.create({
      groupId: id,
      topic: topic.slice(0, 300),
      assignedTo,
      notes: String(req.body.notes || '').slice(0, 4000),
      createdBy: userId,
    });
    await addMemberPoints(id, userId, 2);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateTopic = async (req, res) => {
  const { id, topicId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const doc = await GroupTopic.findOne({ _id: topicId, groupId: id });
    if (!doc) return res.status(404).json({ error: 'Topic not found' });
    const admin = isGroupAdmin(group, userId);
    const isCreator = doc.createdBy === userId;
    const isAssignee = doc.assignedTo === userId;
    const body = req.body || {};

    if (body.claim === true) {
      if (doc.assignedTo) return res.status(400).json({ error: 'Topic already assigned' });
      doc.assignedTo = userId;
      if (doc.status === 'pending') doc.status = 'in-progress';
      await doc.save();
      return res.json(doc);
    }

    const wasCompleted = doc.status === 'completed';

    if (body.topic != null || body.assignedTo !== undefined) {
      if (!isCreator && !admin) return res.status(403).json({ error: 'Only creator or admin can edit assignment' });
    }
    if (body.notes != null && !isCreator && !admin && !isAssignee) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (body.status != null && !isCreator && !admin && !isAssignee) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (body.topic != null) doc.topic = String(body.topic).trim().slice(0, 300);
    if (body.notes != null) doc.notes = String(body.notes).slice(0, 4000);
    if (body.assignedTo !== undefined) {
      const next = body.assignedTo ? String(body.assignedTo) : null;
      if (next && !group.members.some((m) => m.userId === next)) {
        return res.status(400).json({ error: 'Assignee is not a group member' });
      }
      doc.assignedTo = next || undefined;
    }
    if (body.status != null) {
      const st = String(body.status);
      if (!['pending', 'in-progress', 'completed'].includes(st)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      doc.status = st;
    }

    await doc.save();

    if (!wasCompleted && doc.status === 'completed' && doc.assignedTo) {
      await addMemberPoints(id, doc.assignedTo, 5);
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteTopic = async (req, res) => {
  const { id, topicId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const doc = await GroupTopic.findOne({ _id: topicId, groupId: id });
    if (!doc) return res.status(404).json({ error: 'Topic not found' });
    if (doc.createdBy !== userId && !isGroupAdmin(group, userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await doc.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Quizzes ─────────────────────────────────────────

export const listQuizzes = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const quizzes = await GroupQuiz.find({ groupId: id }).sort({ createdAt: -1 }).lean();
    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createQuiz = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const question = String(req.body.question || '').trim();
  const options = Array.isArray(req.body.options) ? req.body.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
  const correctOption = Number(req.body.correctOption);
  if (!question) return res.status(400).json({ error: 'Question is required' });
  if (options.length < 2 || options.length > 4) {
    return res.status(400).json({ error: 'Provide between 2 and 4 options' });
  }
  if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) {
    return res.status(400).json({ error: 'Invalid correct option index' });
  }
  try {
    const doc = await GroupQuiz.create({
      groupId: id,
      question: question.slice(0, 2000),
      options: options.map((o) => o.slice(0, 500)),
      correctOption,
      explanation: String(req.body.explanation || '').slice(0, 3000),
      createdBy: userId,
    });
    await addMemberPoints(id, userId, 3);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const generateAiQuiz = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI is not configured' });
  try {
    const subject = group.subject || 'General studies';
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You output only valid JSON, no markdown. Schema: {"question":string,"options":string[] length 4,"correctOption":number 0-3,"explanation":string}. Multiple choice for students.',
          },
          {
            role: 'user',
            content: `Create one multiple-choice question for subject: ${subject}. Suitable for Nigerian secondary or university students.`,
          },
        ],
        max_tokens: 500,
        temperature: 0.6,
      }),
    });
    const data = await response.json();
    let raw = data?.choices?.[0]?.message?.content?.trim() || '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'AI returned invalid JSON' });
    }
    const question = String(parsed.question || '').trim();
    const options = Array.isArray(parsed.options) ? parsed.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    const correctOption = Number(parsed.correctOption);
    const explanation = String(parsed.explanation || '').trim();
    if (!question || options.length < 2 || options.length > 4) {
      return res.status(502).json({ error: 'AI question incomplete' });
    }
    if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) {
      return res.status(502).json({ error: 'AI correctOption invalid' });
    }
    const doc = await GroupQuiz.create({
      groupId: id,
      question: question.slice(0, 2000),
      options: options.map((o) => o.slice(0, 500)),
      correctOption,
      explanation: explanation.slice(0, 3000),
      createdBy: userId,
    });
    await addMemberPoints(id, userId, 3);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const answerQuiz = async (req, res) => {
  const { id, quizId } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const answer = Number(req.body.answer);
  if (!Number.isInteger(answer)) return res.status(400).json({ error: 'answer must be an integer index' });
  try {
    const quiz = await GroupQuiz.findOne({ _id: quizId, groupId: id });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (quiz.answeredBy.some((a) => a.userId === userId)) {
      return res.status(400).json({ error: 'Already answered' });
    }
    if (answer < 0 || answer >= quiz.options.length) {
      return res.status(400).json({ error: 'Invalid option' });
    }
    const correct = answer === quiz.correctOption;
    quiz.answeredBy.push({
      userId,
      answer,
      correct,
      answeredAt: new Date(),
    });
    await quiz.save();
    if (correct) await addMemberPoints(id, userId, 5);
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Whiteboard ─────────────────────────────────────────

export const getWhiteboard = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  try {
    const wb = await GroupWhiteboard.findOne({ groupId: id }).lean();
    if (!wb) {
      return res.json({
        groupId: id,
        content: '',
        version: 0,
        lastEditedBy: null,
        lastEditedAt: null,
      });
    }
    res.json(wb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const putWhiteboard = async (req, res) => {
  const { id } = req.params;
  const userId = getFirebaseUid(req.user);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { group, error, status } = await loadGroupForUser(id, userId);
  if (error) return res.status(status).json({ error });
  const content = String(req.body.content ?? '');
  const clientVersion = Number(req.body.version);
  if (!Number.isInteger(clientVersion) || clientVersion < 0) {
    return res.status(400).json({ error: 'version must be a non-negative integer' });
  }
  if (content.length > 50000) return res.status(400).json({ error: 'Content too long' });
  try {
    let wb = await GroupWhiteboard.findOne({ groupId: id });
    const day = todayUTC();

    if (!wb) {
      if (clientVersion !== 0) {
        return res.status(409).json({
          error: 'Conflict',
          version: 0,
          content: '',
          lastEditedBy: null,
          lastEditedAt: null,
        });
      }
      wb = await GroupWhiteboard.create({
        groupId: id,
        content,
        version: 1,
        lastEditedBy: userId,
        lastEditedAt: new Date(),
        pointDays: [{ userId, day }],
      });
      await addMemberPoints(id, userId, 1);
      return res.json(wb);
    }

    if (wb.version !== clientVersion) {
      return res.status(409).json({
        error: 'Conflict',
        version: wb.version,
        content: wb.content,
        lastEditedBy: wb.lastEditedBy,
        lastEditedAt: wb.lastEditedAt,
      });
    }

    wb.content = content;
    wb.version = wb.version + 1;
    wb.lastEditedBy = userId;
    wb.lastEditedAt = new Date();

    const already = (wb.pointDays || []).some((p) => p.userId === userId && p.day === day);
    if (!already) {
      wb.pointDays = [...(wb.pointDays || []), { userId, day }];
      await addMemberPoints(id, userId, 1);
    }

    await wb.save();
    res.json(wb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
