import ChatHistory from '../models/ChatHistory.js';
import { v4 as uuidv4 } from 'uuid';

// GET /api/chat/history — list recent sessions for user
export const getChatHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    const sessions = await ChatHistory.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select('sessionId title subject createdAt updatedAt messages')
      .lean();

    const preview = sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      subject: s.subject,
      messageCount: s.messages?.length || 0,
      lastMessage:
        s.messages && s.messages.length
          ? (s.messages[s.messages.length - 1].content || '').slice(0, 80)
          : '',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));

    res.json({ success: true, sessions: preview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/chat/history/:sessionId — full session
export const getChatSession = async (req, res) => {
  try {
    const userId = req.user._id;

    const session = await ChatHistory.findOne({
      userId,
      sessionId: req.params.sessionId
    }).lean();

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/chat/history — save or update a session
export const saveChatSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const { sessionId, messages, subject } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'No messages provided' });
    }

    const firstUserMsg = messages.find((m) => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 60) +
        (firstUserMsg.content.length > 60 ? '...' : '')
      : 'New Chat';

    const sid = sessionId || uuidv4();

    const session = await ChatHistory.findOneAndUpdate(
      { userId, sessionId: sid },
      {
        $set: {
          userId,
          sessionId: sid,
          title,
          subject: subject || '',
          messages,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, sessionId: sid, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/chat/history/:sessionId
export const deleteChatSession = async (req, res) => {
  try {
    const userId = req.user._id;
    await ChatHistory.findOneAndDelete({ userId, sessionId: req.params.sessionId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/chat/history/all — clear all sessions for user
export const clearAllChatHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    await ChatHistory.deleteMany({ userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

