import mongoose from 'mongoose';
import StudyGuide from '../models/StudyGuide.js';
import TopicMastery from '../models/TopicMastery.js';
import User from '../models/User.js';
import aiClient from '../utils/aiClient.js';

// ---- PUBLIC ENDPOINTS ----

export const getGuides = async (req, res) => {
    try {
        const {
            subject, topic, difficulty,
            examType, search, page = 1, limit = 12
        } = req.query;

        const query = {};

        // Only filter by validated if explicitly in production
        // During development/seeding — show all guides
        if (process.env.NODE_ENV === 'production') {
            query.validated = true;
        }

        if (subject) query.subject = subject.toLowerCase();
        if (topic) query.topic = new RegExp(topic, 'i');
        if (difficulty) query.difficulty = difficulty;
        if (examType) query.examType = examType.toUpperCase();

        if (search) {
            query.$or = [
                { title: new RegExp(search, 'i') },
                { topic: new RegExp(search, 'i') },
                { summary: new RegExp(search, 'i') }
            ];
        }

        console.log('📚 Library query:', JSON.stringify(query));

        const total = await StudyGuide.countDocuments(query);
        const guides = await StudyGuide.find(query)
            .select('title subject topic examType difficulty estimatedReadTime summary isPremium validated')
            .sort({ subject: 1, topic: 1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean();

        console.log(`📚 Found ${guides.length} guides (total: ${total})`);

        res.json({
            success: true,
            guides,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('❌ Get guides error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getGuide = async (req, res) => {
    try {
        // guideAccessControl middleware adds req.guide
        res.json({ success: true, guide: req.guide });
    } catch (error) {
        console.error('getGuide error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getSubjects = async (req, res) => {
    try {
        const subjects = await StudyGuide.aggregate([
            { $match: { validated: true } },
            {
                $group: {
                    _id: '$subject',
                    count: { $sum: 1 },
                    topics: { $addToSet: '$topic' }
                }
            },
            { $project: { subject: '$_id', count: 1, topics: 1, _id: 0 } }
        ]);
        res.json({ success: true, subjects });
    } catch (error) {
        console.error('getSubjects error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getRecommendedGuides = async (req, res) => {
    try {
        const studentId = new mongoose.Types.ObjectId(req.user._id);

        // Find student's weak topics from TopicMastery
        const weakTopics = await TopicMastery.find({
            studentId,
            mastery: { $in: ['weak', 'developing'] }
        })
            .sort({ accuracy: 1 }) // worst first
            .limit(5)
            .lean();

        if (weakTopics.length === 0) {
            // No weak topics yet — return beginner guides
            const beginner = await StudyGuide.find({
                validated: true,
                difficulty: 'easy'
            }).limit(3).lean();
            return res.json({ success: true, guides: beginner, reason: 'starter' });
        }

        // Find guides matching weak topics
        const topicNames = weakTopics.map(t => t.topic);
        const guides = await StudyGuide.find({
            topic: { $in: topicNames },
            validated: true
        })
            .limit(5)
            .lean();

        // Add mastery context to each guide
        const enriched = guides.map(guide => {
            const mastery = weakTopics.find(t => t.topic === guide.topic);
            return {
                ...guide,
                studentAccuracy: mastery?.accuracy || 0,
                masteryLevel: mastery?.mastery || 'weak'
            };
        });

        res.json({
            success: true,
            guides: enriched,
            reason: 'weak-topics'
        });
    } catch (error) {
        console.error('getRecommendedGuides error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ---- MIDDLEWARE ----

export const guideAccessControl = async (req, res, next) => {
    try {
        const guide = await StudyGuide.findById(req.params.id);
        if (!guide) return res.status(404).json({ error: 'Guide not found' });

        if (guide.isPremium) {
            const user = await User.findById(req.user._id);
            if (!user.plan || user.plan.type === 'free') {
                return res.status(403).json({
                    error: 'Premium guide',
                    message: 'This guide requires a Pro plan. Upgrade for ₦500/week.',
                    showUpgrade: true
                });
            }
        }

        req.guide = guide;
        next();
    } catch (error) {
        console.error('guideAccessControl error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ---- ADMIN ROUTES ----

export const getAdminGuides = async (req, res) => {
    try {
        const { validated } = req.query;
        const query = {};
        if (validated !== undefined) query.validated = validated === 'true';

        const guides = await StudyGuide.find(query).sort({ createdAt: -1 }).lean();
        res.json({ success: true, guides });
    } catch (error) {
        console.error('getAdminGuides error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const createGuide = async (req, res) => {
    try {
        const guide = await StudyGuide.create(req.body);
        res.status(201).json({ success: true, guide });
    } catch (error) {
        console.error('createGuide error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateGuide = async (req, res) => {
    try {
        const guide = await StudyGuide.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!guide) return res.status(404).json({ error: 'Guide not found' });
        res.json({ success: true, guide });
    } catch (error) {
        console.error('updateGuide error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const validateGuide = async (req, res) => {
    try {
        const guide = await StudyGuide.findByIdAndUpdate(req.params.id, { validated: true }, { new: true });
        if (!guide) return res.status(404).json({ error: 'Guide not found' });
        res.json({ success: true, guide });
    } catch (error) {
        console.error('validateGuide error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteGuide = async (req, res) => {
    try {
        await StudyGuide.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Guide deleted' });
    } catch (error) {
        console.error('deleteGuide error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const generateStudyGuide = async (req, res) => {
    const { subject, topic, examType, difficulty } = req.body;

    const prompt = `
You are an expert Nigerian exam preparation tutor for ${examType}.

Write a structured study guide for:
Subject: ${subject}
Topic: ${topic}
Difficulty: ${difficulty}
Exam: ${examType}

STRICT FORMAT — use exactly these sections in markdown:

## Topic Overview
(2-3 sentences: what the topic is and why it appears in ${examType} exams)

## Core Concepts
(clear bullet-point explanations with examples)

## Common Exam Traps
(3-5 specific mistakes students make in ${examType} on this topic)

## Worked Examples
(2-3 step-by-step solved problems or examples)

## Quick Revision Summary
(5-7 bullet points — condensed version students can review in 60 seconds)

RULES:
- Write for Nigerian secondary school / pre-university students
- Be concise and exam-focused. No fluff.
- Use simple clear English
- Do NOT include motivational content
- Do NOT copy from textbooks
- Total length: 400-600 words maximum

After the guide, on a new line write:
SUMMARY: (one sentence summary of the guide)
KEYPOINTS: (comma-separated list of 5 key takeaways)
  `;

    try {
        const response = await aiClient.chatCompletion({
            model: "deepseek-chat",
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 2000
        });

        const raw = response.choices[0].message.content;

        // Parse summary and keypoints from end of response
        const summaryMatch = raw.match(/SUMMARY:\s*(.+)/);
        const keypointsMatch = raw.match(/KEYPOINTS:\s*(.+)/);

        const summary = summaryMatch ? summaryMatch[1].trim() : '';
        const keyPoints = keypointsMatch
            ? keypointsMatch[1].split(',').map(k => k.trim())
            : [];

        // Remove the SUMMARY/KEYPOINTS lines from main content
        const content = raw
            .replace(/SUMMARY:.+/s, '')
            .replace(/KEYPOINTS:.+/s, '')
            .trim();

        // Save as unvalidated
        const guide = await StudyGuide.create({
            title: `${topic} — ${examType} Study Guide`,
            subject: subject.toLowerCase(),
            examType,
            topic,
            difficulty,
            content,
            summary: summary || `${topic} guide generated by AI.`,
            keyPoints: keyPoints.length ? keyPoints : ['Review core concepts', 'Avoid common traps', 'Practice past questions'],
            isPremium: difficulty === 'hard',
            validated: false
        });

        res.json({
            success: true,
            guide,
            message: 'Guide generated. Pending your validation.'
        });

    } catch (err) {
        console.error('Guide generation error:', err);
        res.status(500).json({ error: err.message });
    }
};
export const seedStarterGuides = async (req, res) => {
    const starterGuides = [
        {
            title: 'Comprehension Passages — JAMB Study Guide',
            subject: 'english',
            examType: 'JAMB',
            topic: 'Comprehension',
            difficulty: 'medium',
            summary: 'Master how to read and answer comprehension questions accurately in JAMB English.',
            keyPoints: [
                'Read the passage before looking at questions',
                'Answers are always in the passage — never guess',
                'Watch for negative questions like "which is NOT true"',
                'Vocabulary questions test context meaning not dictionary meaning',
                'Inference questions require reading between the lines'
            ],
            content: `## Topic Overview
Comprehension passages test your ability to understand written English and extract meaning accurately. It is one of the highest-scoring sections in JAMB English.

## Core Concepts
- **Active Reading**: Read with the purpose of understanding, not just finishing
- **Question Types**: Factual, Inferential, Vocabulary-in-context, Summary
- **Passage Structure**: Introduction → Body → Conclusion

## Common Exam Traps
- Choosing answers that sound correct but aren't stated in the passage
- Confusing the author's view with a character's view
- Missing negative questions ("which does NOT apply")
- Using outside knowledge instead of passage content

## Worked Examples
**Example:** If the passage says "the economy was sluggish", and the question asks what "sluggish" means in context, the answer is "slow-moving" not "lazy" (common trap).

## Quick Revision Summary
- Always read passage first, questions second
- All answers exist within the passage
- Underline key sentences as you read
- Eliminate obviously wrong options first
- Never use outside knowledge`,
            validated: true,
            isPremium: false
        },
        {
            title: 'Quadratic Equations — JAMB Study Guide',
            subject: 'mathematics',
            examType: 'JAMB',
            topic: 'Quadratic Equations',
            difficulty: 'medium',
            summary: 'Learn the three methods to solve quadratic equations and avoid common JAMB mistakes.',
            keyPoints: [
                'Three methods: factorization, completing the square, quadratic formula',
                'Always set equation to zero before solving',
                'Check your answers by substituting back',
                'Sum of roots = -b/a, Product of roots = c/a',
                'Discriminant determines number of solutions'
            ],
            content: `## Topic Overview
Quadratic equations appear in almost every JAMB Mathematics paper. Mastering this topic alone can add 4-6 marks to your score.

## Core Concepts
- **Standard Form**: ax² + bx + c = 0
- **Factorization**: Find two numbers that multiply to ac and add to b
- **Quadratic Formula**: x = (-b ± √(b²-4ac)) / 2a
- **Discriminant**: b²-4ac determines roots (positive=2 roots, zero=1 root, negative=no real roots)

## Common Exam Traps
- Forgetting to set equation to zero first
- Sign errors when substituting into the formula
- Confusing sum and product of roots
- Not checking if factorization is fully simplified

## Worked Examples
**Solve**: x² + 5x + 6 = 0
Step 1: Find factors of 6 that add to 5 → 2 and 3
Step 2: (x + 2)(x + 3) = 0
Step 3: x = -2 or x = -3

## Quick Revision Summary
- Set to zero first always
- Try factorization first (fastest)
- Use formula when factorization fails
- Sum of roots = -b/a
- Product of roots = c/a`,
            validated: true,
            isPremium: false
        },
        {
            title: 'Cell Structure and Function — JAMB Study Guide',
            subject: 'biology',
            examType: 'JAMB',
            topic: 'Cell Biology',
            difficulty: 'easy',
            summary: 'Understand cell organelles, their functions and the differences between plant and animal cells.',
            keyPoints: [
                'Plant cells have cell wall, chloroplast and large vacuole — animal cells do not',
                'Mitochondria is the powerhouse — produces ATP via respiration',
                'Nucleus controls cell activities and contains DNA',
                'Ribosomes are the site of protein synthesis',
                'Cell membrane controls what enters and leaves the cell'
            ],
            content: `## Topic Overview
Cell biology is the foundation of all Biology. JAMB tests this topic in almost every paper — usually 3-5 questions.

## Core Concepts
**Animal Cell Organelles:**
- Nucleus: control center, contains DNA
- Mitochondria: energy production (ATP)
- Ribosomes: protein synthesis
- Cell membrane: selective barrier

**Plant Cell (extra structures):**
- Cell wall: rigid support (made of cellulose)
- Chloroplast: photosynthesis
- Large central vacuole: stores water and maintains turgor

## Common Exam Traps
- Confusing cell wall (plant) with cell membrane (both)
- Saying mitochondria is only in animal cells (wrong — plants have it too)
- Confusing chloroplast function with mitochondria function
- Forgetting that ribosomes have NO membrane

## Worked Examples
**Q:** Which organelle is responsible for protein synthesis?
**A:** Ribosomes — found in both plant and animal cells, either free or on rough ER

## Quick Revision Summary
- Nucleus = control + DNA storage
- Mitochondria = energy (ATP)
- Ribosomes = protein synthesis (no membrane)
- Chloroplast = photosynthesis (plants only)
- Cell wall = plants only (cellulose)`,
            validated: true,
            isPremium: false
        }
    ];

    try {
        // Clear existing unvalidated guides to avoid conflicts
        await StudyGuide.deleteMany({ validated: false });

        // Insert starter guides
        const result = await StudyGuide.insertMany(starterGuides, { ordered: false });

        res.json({
            success: true,
            inserted: result.length,
            message: `✅ ${result.length} starter guides seeded and validated!`
        });
    } catch (err) {
        // If some already exist, still return success
        res.json({
            success: true,
            message: 'Seed attempted — some guides may already exist',
            error: err.message
        });
    }
};

export const validateAllGuides = async (req, res) => {
    try {
        const result = await StudyGuide.updateMany(
            { validated: false },
            { $set: { validated: true } }
        );
        res.json({
            success: true,
            updated: result.modifiedCount,
            message: `✅ ${result.modifiedCount} guides are now validated and visible`
        });
    } catch (err) {
        console.error('validateAllGuides error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
