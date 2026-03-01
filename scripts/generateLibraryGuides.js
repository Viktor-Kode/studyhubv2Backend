import mongoose from 'mongoose';
import { getEnv } from '../src/config/env.js';
import connectDB from '../src/config/db.js';
import StudyGuide from '../src/models/StudyGuide.js';
import aiClient from '../src/utils/aiClient.js';
import '../src/config/aiConfig.js'; // Ensure providers are registered if needed

const guidePlan = [
    // English — 10 guides
    { subject: 'english', topic: 'Comprehension Passages', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'english', topic: 'Lexis and Structure', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'english', topic: 'Oral English & Phonetics', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'english', topic: 'Figures of Speech', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'english', topic: 'Antonyms and Synonyms', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'english', topic: 'Sentence Completion', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'english', topic: 'Idioms and Proverbs', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'english', topic: 'Punctuation and Spelling', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'english', topic: 'Register and Usage', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'english', topic: 'Summary Writing', examType: 'JAMB', difficulty: 'hard' },

    // Mathematics — 10 guides
    { subject: 'mathematics', topic: 'Linear Equations', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'mathematics', topic: 'Quadratic Equations', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'mathematics', topic: 'Indices and Logarithms', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'mathematics', topic: 'Trigonometry Basics', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'mathematics', topic: 'Sets and Venn Diagrams', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'mathematics', topic: 'Statistics and Probability', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'mathematics', topic: 'Sequences and Series', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'mathematics', topic: 'Circle Theorems', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'mathematics', topic: 'Fractions and Decimals', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'mathematics', topic: 'Word Problems', examType: 'JAMB', difficulty: 'medium' },

    // Biology — 10 guides
    { subject: 'biology', topic: 'Cell Structure and Function', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'biology', topic: 'Genetics and Heredity', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'biology', topic: 'Ecology and Environment', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'biology', topic: 'Photosynthesis and Respiration', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'biology', topic: 'Human Reproduction', examType: 'JAMB', difficulty: 'medium' },
    { subject: 'biology', topic: 'Evolution and Natural Selection', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'biology', topic: 'Transport in Plants', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'biology', topic: 'Nervous System', examType: 'JAMB', difficulty: 'hard' },
    { subject: 'biology', topic: 'Classification of Living Things', examType: 'JAMB', difficulty: 'easy' },
    { subject: 'biology', topic: 'Nutrition and Digestion', examType: 'JAMB', difficulty: 'easy' },
];

const generateStudyGuideFromScript = async ({ subject, topic, examType, difficulty }) => {
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

    const response = await aiClient.chatCompletion({
        model: "deepseek-chat",
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 2000
    });

    const raw = response.choices[0].message.content;

    const summaryMatch = raw.match(/SUMMARY:\s*(.+)/);
    const keypointsMatch = raw.match(/KEYPOINTS:\s*(.+)/);

    const summary = summaryMatch ? summaryMatch[1].trim() : '';
    const keyPoints = keypointsMatch
        ? keypointsMatch[1].split(',').map(k => k.trim())
        : [];

    const content = raw
        .replace(/SUMMARY:.+/s, '')
        .replace(/KEYPOINTS:.+/s, '')
        .trim();

    await StudyGuide.create({
        title: `${topic} — ${examType} Study Guide`,
        subject: subject.toLowerCase(),
        examType,
        topic,
        difficulty,
        content,
        summary,
        keyPoints,
        isPremium: difficulty === 'hard',
        validated: false // Generate unvalidated by default
    });
};

const runGuideGeneration = async () => {
    await connectDB();
    console.log(`Generating ${guidePlan.length} study guides...`);

    for (const guide of guidePlan) {
        try {
            console.log(`📝 Generating: ${guide.subject} — ${guide.topic}`);
            await generateStudyGuideFromScript(guide);
            await new Promise(r => setTimeout(r, 4000)); // 4s delay
        } catch (err) {
            console.error(`❌ Failed: ${guide.topic}`, err.message);
        }
    }

    console.log('✅ All guides generated. Go validate them in /admin/guides');
    process.exit(0);
};

runGuideGeneration();
