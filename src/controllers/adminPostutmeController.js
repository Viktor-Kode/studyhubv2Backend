import University from '../models/University.js';
import PostUTMEQuestion from '../models/PostUTMEQuestion.js';
import aiClient from '../utils/aiClient.js';

const requireAdmin = (req, res, next) => {
  const { secretKey } = req.body;
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// POST /api/admin/postutme/seed-universities
export const seedUniversities = async (req, res) => {
  const { secretKey } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const universities = [
    { name: 'University of Lagos', shortName: 'UNILAG', slug: 'unilag', location: 'Lagos', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics'] },
    { name: 'Obafemi Awolowo University', shortName: 'OAU', slug: 'oau', location: 'Osun', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics'] },
    { name: 'University of Ibadan', shortName: 'UI', slug: 'ui', location: 'Oyo', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'University of Nigeria Nsukka', shortName: 'UNN', slug: 'unn', location: 'Enugu', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Ahmadu Bello University', shortName: 'ABU', slug: 'abu', location: 'Kaduna', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'University of Benin', shortName: 'UNIBEN', slug: 'uniben', location: 'Edo', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Federal University of Technology Akure', shortName: 'FUTA', slug: 'futa', location: 'Ondo', type: 'federal', availableSubjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English'] },
    { name: 'University of Ilorin', shortName: 'UNILORIN', slug: 'unilorin', location: 'Kwara', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'University of Port Harcourt', shortName: 'UNIPORT', slug: 'uniport', location: 'Rivers', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Nnamdi Azikiwe University', shortName: 'UNIZIK', slug: 'unizik', location: 'Anambra', type: 'federal', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Lagos State University', shortName: 'LASU', slug: 'lasu', location: 'Lagos', type: 'state', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics'] },
    { name: 'Olabisi Onabanjo University', shortName: 'OOU', slug: 'oou', location: 'Ogun', type: 'state', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Ambrose Alli University', shortName: 'AAU', slug: 'aau', location: 'Edo', type: 'state', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Covenant University', shortName: 'CU', slug: 'cu', location: 'Ogun', type: 'private', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics'] },
    { name: 'Babcock University', shortName: 'BABCOCK', slug: 'babcock', location: 'Ogun', type: 'private', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] },
    { name: 'Redeemers University', shortName: 'RUN', slug: 'run', location: 'Osun', type: 'private', availableSubjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'] }
  ];

  try {
    await University.insertMany(universities, { ordered: false });
    res.json({ success: true, inserted: universities.length });
  } catch (err) {
    res.json({ success: true, message: 'Some already exist', error: err.message });
  }
};

// POST /api/admin/postutme/universities
export const addUniversity = async (req, res) => {
  const { secretKey, ...data } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const uni = await University.create(data);
    res.status(201).json({ success: true, university: uni });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// PUT /api/admin/postutme/universities/:id
export const updateUniversity = async (req, res) => {
  const { secretKey, ...updates } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const uni = await University.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!uni) return res.status(404).json({ success: false, error: 'University not found' });
    res.json({ success: true, university: uni });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// POST /api/admin/postutme/questions
export const addQuestion = async (req, res) => {
  const { secretKey, ...data } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const q = await PostUTMEQuestion.create(data);
    res.status(201).json({ success: true, question: q });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// POST /api/admin/postutme/questions/bulk
export const bulkImportQuestions = async (req, res) => {
  const { secretKey, questions } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!Array.isArray(questions)) {
    return res.status(400).json({ success: false, error: 'questions must be an array' });
  }
  try {
    const result = await PostUTMEQuestion.insertMany(questions, { ordered: false });
    res.json({ success: true, inserted: result.length });
  } catch (err) {
    const inserted = err.insertedDocs ? err.insertedDocs.length : 0;
    res.json({ success: true, inserted, error: err.message });
  }
};

// POST /api/admin/postutme/questions/generate-ai
export const generateAIQuestions = async (req, res) => {
  const { secretKey, universitySlug, subject, count = 20 } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!universitySlug || !subject) {
    return res.status(400).json({ success: false, error: 'universitySlug and subject required' });
  }
  try {
    const uni = await University.findOne({ slug: universitySlug });
    if (!uni) return res.status(404).json({ success: false, error: 'University not found' });

    const prompt = `Generate ${count} Post-UTME multiple choice questions for ${uni.name} (${universitySlug.toUpperCase()}).
Subject: ${subject}
Return ONLY a valid JSON array:
[{"questionText":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctAnswer":"A","explanation":"...","topic":"...","difficulty":"medium"}]`;

    const response = await aiClient.generateChatResponse([{ role: 'user', content: prompt }]);
    let raw = (response || '').replace(/```json|```/g, '').trim();
    const list = JSON.parse(raw);
    const arr = Array.isArray(list) ? list : [list];

    const toInsert = arr.map((q, i) => ({
      universityId: uni._id,
      universitySlug,
      subject,
      year: new Date().getFullYear(),
      questionNumber: i + 1,
      questionText: q.questionText || q.question || '',
      options: q.options || {},
      correctAnswer: (q.correctAnswer || 'A').toUpperCase().charAt(0),
      explanation: q.explanation || '',
      topic: q.topic || '',
      difficulty: q.difficulty || 'medium',
      source: 'AI-generated',
      validated: true
    }));

    let inserted = 0;
    try {
      const result = await PostUTMEQuestion.insertMany(toInsert, { ordered: false });
      inserted = result.length;
    } catch (e) {
      inserted = e.insertedDocs ? e.insertedDocs.length : 0;
    }
    res.json({ success: true, inserted, total: arr.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/admin/postutme/questions/:id/validate
export const validateQuestion = async (req, res) => {
  const { secretKey } = req.body || {};
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const q = await PostUTMEQuestion.findByIdAndUpdate(
      req.params.id,
      { validated: true },
      { new: true }
    );
    if (!q) return res.status(404).json({ success: false, error: 'Question not found' });
    res.json({ success: true, question: q });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
