import StudyNote from '../models/StudyNote.js';

// GET /api/notes
export const getNotes = async (req, res) => {
  try {
    const userId = req.user._id;
    const { subject, search } = req.query;

    const filter = { userId };

    if (subject && subject.toLowerCase() !== 'all') {
      filter.subject = subject;
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { title: regex },
        { content: regex },
        { tags: regex }
      ];
    }

    const notes = await StudyNote.find(filter)
      .sort({ isPinned: -1, updatedAt: -1 })
      .lean();

    res.status(200).json({ success: true, notes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/notes
export const createNote = async (req, res) => {
  try {
    const userId = req.user._id;
    const { title, content, subject, topic, source, tags, color } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const note = await StudyNote.create({
      userId,
      title,
      content,
      subject: subject || 'General',
      topic: topic || '',
      source: source || 'manual',
      tags: Array.isArray(tags) ? tags : [],
      color: color || '#ffffff'
    });

    res.status(201).json({ success: true, note });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PUT /api/notes/:id
export const updateNote = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = { ...req.body };

    if (updates.tags && !Array.isArray(updates.tags)) {
      updates.tags = [];
    }

    const note = await StudyNote.findOneAndUpdate(
      { _id: req.params.id, userId },
      updates,
      { new: true }
    );

    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    res.status(200).json({ success: true, note });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/notes/:id
export const deleteNote = async (req, res) => {
  try {
    const userId = req.user._id;

    const deleted = await StudyNote.findOneAndDelete({ _id: req.params.id, userId });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    res.status(200).json({ success: true, message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/notes/:id/pin
export const togglePin = async (req, res) => {
  try {
    const userId = req.user._id;

    const note = await StudyNote.findOne({ _id: req.params.id, userId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    note.isPinned = !note.isPinned;
    await note.save();

    res.status(200).json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/notes/from-ai
export const createNoteFromAI = async (req, res) => {
  try {
    const userId = req.user._id;
    const { title, content, subject, topic, tags, color } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const note = await StudyNote.create({
      userId,
      title,
      content,
      subject: subject || 'General',
      topic: topic || '',
      source: 'ai-generated',
      tags: Array.isArray(tags) ? tags : [],
      color: color || '#ffffff'
    });

    res.status(201).json({ success: true, note });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

