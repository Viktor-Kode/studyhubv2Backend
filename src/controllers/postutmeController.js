import University from '../models/University.js';
import PostUTMEQuestion from '../models/PostUTMEQuestion.js';
import PostUTMEResult from '../models/PostUTMEResult.js';
import aiClient from '../utils/aiClient.js';

// GET /api/postutme/universities
export const getUniversities = async (req, res) => {
  try {
    const { type, search } = req.query;
    const query = { isActive: true };

    if (type) query.type = type;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { name: regex },
        { shortName: regex },
        { slug: regex }
      ];
    }

    const universities = await University.find(query)
      .sort({ name: 1 })
      .lean();

    res.json({ success: true, universities });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/postutme/universities/:slug
export const getUniversityBySlug = async (req, res) => {
  try {
    const uni = await University.findOne({
      slug: req.params.slug,
      isActive: true
    }).lean();

    if (!uni) {
      return res.status(404).json({ success: false, error: 'University not found' });
    }

    const stats = await PostUTMEQuestion.aggregate([
      { $match: { universitySlug: req.params.slug, validated: true } },
      {
        $group: {
          _id: null,
          years: { $addToSet: '$year' },
          subjects: { $addToSet: '$subject' },
          total: { $sum: 1 }
        }
      }
    ]);

    const qs = stats[0] || { years: [], subjects: [], total: 0 };
    const availableYears = (qs.years || []).sort((a, b) => b - a);
    const availableSubjects = (qs.subjects || []).sort();

    res.json({
      success: true,
      university: {
        ...uni,
        availableYears,
        availableSubjects,
        totalQuestions: qs.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Background AI generation when questions are low
const generateAndCacheQuestions = async (slug, subject, uniName) => {
  try {
    const prompt = `
Generate 20 Post-UTME multiple choice questions for ${uniName} (${slug.toUpperCase()}).
Subject: ${subject}
Style: Match the actual ${uniName} Post-UTME exam style and difficulty.
Focus on topics commonly tested in ${uniName} Post-UTME.

Return ONLY a valid JSON array. No extra text:
[
  {
    "questionText": "...",
    "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "correctAnswer": "A",
    "explanation": "...",
    "topic": "...",
    "difficulty": "medium"
  }
]
`.trim();

    const response = await aiClient.generateChatResponse([
      { role: 'user', content: prompt }
    ]);

    let raw = (response || '').replace(/```json|```/g, '').trim();
    const generated = JSON.parse(raw);
    const list = Array.isArray(generated) ? generated : [generated];

    const uni = await University.findOne({ slug });
    if (!uni) return;

    const toInsert = list.map((q, i) => ({
      universityId: uni._id,
      universitySlug: slug,
      subject: subject || 'General',
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

    await PostUTMEQuestion.insertMany(toInsert, { ordered: false }).catch(() => {});
    console.log(`✅ Generated ${toInsert.length} questions for ${slug} ${subject}`);
  } catch (err) {
    console.error('Post-UTME AI generation error:', err.message);
  }
};

// GET /api/postutme/questions
export const getPostUTMEQuestions = async (req, res) => {
  try {
    const { university, subject, year, count = 40 } = req.query;

    if (!university) {
      return res.status(400).json({ success: false, error: 'University is required' });
    }

    const query = { universitySlug: university, validated: true };
    if (subject) query.subject = subject;
    if (year) query.year = parseInt(year);

    let questions = await PostUTMEQuestion.find(query)
      .limit(parseInt(count) || 40)
      .lean();

    questions = questions.sort(() => Math.random() - 0.5);

    if (questions.length < (parseInt(count) || 40) * 0.5) {
      const uni = await University.findOne({ slug: university });
      if (uni) {
        generateAndCacheQuestions(university, subject || 'General', uni.name);
      }
    }

    const formatted = questions.map((q) => {
      const opts = q.options || {};
      const optArr = ['A', 'B', 'C', 'D'].map((k) => opts[k] || '').filter(Boolean);
      return {
        _id: q._id,
        id: String(q._id),
        questionText: q.questionText,
        question: q.questionText,
        options: optArr.length ? optArr : Object.values(opts).filter(Boolean),
        correctAnswer: ['A', 'B', 'C', 'D'].indexOf((q.correctAnswer || 'A').toUpperCase()),
        explanation: q.explanation,
        subject: q.subject,
        year: String(q.year),
        image: q.image
      };
    });

    res.json({
      success: true,
      questions: formatted,
      total: formatted.length,
      university,
      subject: subject || 'mixed',
      year: year || 'mixed'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/postutme/results
export const savePostUTMEResult = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      universityId, universitySlug, universityName,
      subject, year, totalQuestions, correctAnswers, wrongAnswers,
      skipped, accuracy, timeTaken, answers
    } = req.body;

    const result = await PostUTMEResult.create({
      studentId: userId,
      universityId,
      universitySlug,
      universityName,
      subject,
      year,
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      skipped: skipped || 0,
      accuracy,
      timeTaken,
      answers: answers || []
    });

    res.status(201).json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/postutme/results
export const getPostUTMEResults = async (req, res) => {
  try {
    const results = await PostUTMEResult.find({ studentId: req.user._id })
      .sort({ takenAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/postutme/results/:id
export const getPostUTMEResultById = async (req, res) => {
  try {
    const result = await PostUTMEResult.findOne({
      _id: req.params.id,
      studentId: req.user._id
    }).lean();

    if (!result) {
      return res.status(404).json({ success: false, error: 'Result not found' });
    }

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
