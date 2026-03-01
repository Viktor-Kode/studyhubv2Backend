import mongoose from 'mongoose';
import StudyGuide from '../models/StudyGuide.js';
import TopicMastery from '../models/TopicMastery.js';
import User from '../models/User.js';
import aiClient from '../utils/aiClient.js';

// ---- PUBLIC ENDPOINTS ----

export const getGuides = async (req, res) => {
    try {
        const { subject, topic, difficulty, examType, search, page = 1, limit = 12 } = req.query;

        const query = { validated: true };
        if (subject) query.subject = subject.toLowerCase();
        if (topic) query.topic = topic;
        if (difficulty) query.difficulty = difficulty;
        if (examType) query.examType = examType.toUpperCase();
        if (search) {
            query.$text = { $search: search };
        }

        const guides = await StudyGuide.find(query)
            .sort(search ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean();

        const total = await StudyGuide.countDocuments(query);

        res.json({
            success: true,
            guides,
            total,
            pages: Math.ceil(total / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        console.error('getGuides error:', error);
        res.status(500).json({ success: false, error: error.message });
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
