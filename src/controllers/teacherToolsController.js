import { callAI } from '../utils/aiClient.js';
import User from '../models/User.js';
import Result from '../models/Result.js';
import LessonNote from '../models/LessonNote.js';
import { TEACHER_PLANS } from '../config/plans.js';

// ── GET TEACHER USAGE & PLAN ──────────────────────────
export const getTeacherUsage = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('teacherPlan teacherPlanEnd teacherUsage');
        const isPaid = user.teacherPlan !== 'free' &&
            user.teacherPlanEnd &&
            new Date(user.teacherPlanEnd) > new Date();
        res.json({
            success: true,
            teacherPlan: user.teacherPlan || 'free',
            teacherPlanEnd: user.teacherPlanEnd,
            teacherUsage: user.teacherUsage || {},
            isPaid,
            limit: TEACHER_PLANS.free.usagePerFeature
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getGrade = (score) => {
    if (score >= 70) return 'A';
    if (score >= 60) return 'B';
    if (score >= 50) return 'C';
    if (score >= 40) return 'D';
    if (score >= 30) return 'E';
    return 'F';
};

const getRemark = (score) => {
    if (score >= 70) return 'Excellent';
    if (score >= 60) return 'Very Good';
    if (score >= 50) return 'Good';
    if (score >= 40) return 'Pass';
    if (score >= 30) return 'Poor';
    return 'Fail';
};

// ── 1. LESSON NOTE GENERATOR ──────────────────────────
export const generateLessonNote = async (req, res) => {
    try {
        const {
            subject, topic, classLevel, duration,
            curriculum = 'Nigerian (NERDC)'
        } = req.body;

        if (!subject || !topic || !classLevel) {
            return res.status(400).json({ error: 'Subject, topic and class level required' });
        }

        const prompt = `You are an expert Nigerian teacher. Generate a detailed, professional lesson note.

Subject: ${subject}
Topic: ${topic}
Class: ${classLevel}
Duration: ${duration || 40} minutes
Curriculum: ${curriculum}

Return ONLY a JSON object:
{
  "subject": "",
  "topic": "",
  "class": "",
  "duration": "",
  "date": "",
  "objectives": ["By the end of this lesson, students should be able to..."],
  "previousKnowledge": "",
  "materials": [""],
  "introduction": "",
  "steps": [
    {
      "title": "Step 1 — Introduction (5 mins)",
      "teacherActivity": "",
      "studentActivity": "",
      "content": ""
    }
  ],
  "classActivity": "",
  "evaluation": ["Question 1", "Question 2", "Question 3"],
  "assignment": "",
  "conclusion": "",
  "references": ""
}`;

        const content = await callAI(prompt, 2000);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const note = JSON.parse(cleaned);

        const saved = await LessonNote.create({
            teacherId: req.user._id,
            subject,
            topic,
            classLevel,
            content: note
        });

        res.json({ success: true, note, id: saved._id });
    } catch (err) {
        console.error('[LessonNote]', err);
        res.status(500).json({ error: err.message });
    }
};

// ── 2. RESULT COMPILER ───────────────────────────────
export const compileResults = async (req, res) => {
    try {
        const {
            className, subject, term, year,
            gradingType,
            caWeight, examWeight,
            students
        } = req.body;

        if (!students || students.length === 0) {
            return res.status(400).json({ error: 'No students provided' });
        }

        const processed = students.map(s => {
            let total;
            if (gradingType === 'weighted') {
                total = (parseFloat(s.ca) || 0) * (parseFloat(caWeight) || 40) / 100 +
                    (parseFloat(s.exam) || 0) * (parseFloat(examWeight) || 60) / 100;
            } else {
                total = (parseFloat(s.ca) || 0) + (parseFloat(s.exam) || 0);
            }
            total = Math.round(total * 10) / 10;

            return {
                name: s.name,
                ca: parseFloat(s.ca) || 0,
                exam: parseFloat(s.exam) || 0,
                total,
                grade: getGrade(total),
                remark: getRemark(total)
            };
        });

        const sorted = [...processed].sort((a, b) => b.total - a.total);
        let position = 1;
        sorted.forEach((s, i) => {
            if (i > 0 && s.total < sorted[i - 1].total) position = i + 1;
            const orig = processed.find(p => p.name === s.name);
            if (orig) orig.position = position;
        });

        const totals = processed.map(s => s.total);
        const classAverage = (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1);
        const highest = Math.max(...totals);
        const lowest = Math.min(...totals);
        const passed = processed.filter(s => s.total >= 50).length;

        const result = await Result.create({
            teacherId: req.user._id,
            className, subject, term, year,
            gradingType, caWeight, examWeight,
            students: processed,
            stats: { classAverage, highest, lowest, passed, total: students.length }
        });

        res.json({
            success: true,
            students: processed,
            stats: { classAverage, highest, lowest, passed, total: students.length },
            id: result._id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 3. REPORT CARD COMMENTS ──────────────────────────
export const generateReportComments = async (req, res) => {
    try {
        const { students, subject, term } = req.body;

        if (!students || students.length === 0) {
            return res.status(400).json({ error: 'No students provided' });
        }

        const prompt = `You are a Nigerian school teacher writing report card comments.
Generate a professional, personalised report card comment for each student.
Keep each comment to 2-3 sentences. Be encouraging but honest.
Subject: ${subject || 'General'}, Term: ${term || 'First Term'}

Students:
${students.map((s, i) => `${i + 1}. Name: ${s.name}, Score: ${s.score}, Grade: ${s.grade || 'N/A'}, Strengths: ${s.strengths || 'N/A'}, Weaknesses: ${s.weaknesses || 'N/A'}`).join('\n')}

Return ONLY a JSON array:
[
  { "name": "Student Name", "comment": "Professional comment here." }
]`;

        const content = await callAI(prompt, 2000);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const comments = JSON.parse(cleaned);

        res.json({ success: true, comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 4. SCHEME OF WORK ────────────────────────────────
export const generateSchemeOfWork = async (req, res) => {
    try {
        const { subject, classLevel, term, weeksCount = 13 } = req.body;

        if (!subject || !classLevel) {
            return res.status(400).json({ error: 'Subject and class level required' });
        }

        const prompt = `Generate a detailed Nigerian school scheme of work.
Subject: ${subject}
Class: ${classLevel}
Term: ${term || 'First Term'}
Weeks: ${weeksCount}
Curriculum: Nigerian NERDC/WAEC syllabus

Return ONLY a JSON array of weeks:
[
  {
    "week": 1,
    "topic": "",
    "subtopics": [""],
    "objectives": [""],
    "activities": [""],
    "resources": [""],
    "evaluation": ""
  }
]`;

        const content = await callAI(prompt, 3000);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const scheme = JSON.parse(cleaned);

        res.json({ success: true, scheme });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 5. MARKING SCHEME ────────────────────────────────
export const generateMarkingScheme = async (req, res) => {
    try {
        const { questions, totalMarks, subject } = req.body;

        if (!questions || questions.length === 0) {
            return res.status(400).json({ error: 'No questions provided' });
        }

        const prompt = `You are a Nigerian examiner. Generate a detailed marking scheme.
Subject: ${subject || 'General'}
Total Marks: ${totalMarks || 100}

Questions:
${questions.map((q, i) => `${i + 1}. [${q.marks || 1} marks] ${q.text}`).join('\n')}

Return ONLY a JSON array:
[
  {
    "questionNumber": 1,
    "question": "",
    "marks": 0,
    "keyPoints": ["Point worth X mark", "Point worth Y mark"],
    "modelAnswer": "",
    "commonErrors": [""]
  }
]`;

        const content = await callAI(prompt, 2000);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const scheme = JSON.parse(cleaned);

        res.json({ success: true, scheme });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 6. DIFFERENTIATED QUESTIONS ──────────────────────
export const generateDifferentiated = async (req, res) => {
    try {
        const { topic, subject, classLevel, questionCount, documentText } = req.body;

        if (!topic || !subject) {
            return res.status(400).json({ error: 'Topic and subject required' });
        }

        const prompt = `Generate 3 versions of a test on the same topic for different ability levels.
Subject: ${subject}, Topic: ${topic}, Class: ${classLevel || 'General'}
Questions per version: ${questionCount || 10}
${documentText ? `Based on: ${documentText.slice(0, 3000)}` : ''}

Return ONLY JSON:
{
  "easy": {
    "label": "Version A — Foundation",
    "description": "For students who need extra support",
    "questions": [{ "text": "", "options": ["A.","B.","C.","D."], "answer": "", "marks": 1 }]
  },
  "medium": {
    "label": "Version B — Core",
    "description": "For average students",
    "questions": []
  },
  "hard": {
    "label": "Version C — Extension",
    "description": "For advanced students",
    "questions": []
  }
}`;

        const content = await callAI(prompt, 4000);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const sets = JSON.parse(cleaned);

        res.json({ success: true, sets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 7. READING COMPREHENSION ─────────────────────────
export const generateComprehension = async (req, res) => {
    try {
        const { passage, classLevel, questionCount = 10 } = req.body;

        if (!passage || passage.trim().length < 100) {
            return res.status(400).json({ error: 'Please provide a passage of at least 100 characters' });
        }

        const prompt = `Generate a reading comprehension exercise for ${classLevel || 'students'}.

Passage:
${passage.slice(0, 3000)}

Generate ${questionCount} questions including: comprehension questions, vocabulary questions, and summary/inference questions.

Return ONLY JSON:
{
  "passage": "${passage.slice(0, 200)}...",
  "questions": [
    {
      "type": "comprehension",
      "text": "",
      "options": ["A.", "B.", "C.", "D."],
      "answer": "",
      "marks": 2
    }
  ],
  "summary_question": "Write a summary of the passage in not more than 50 words.",
  "vocabulary": [
    { "word": "", "meaning": "", "usedInSentence": "" }
  ]
}`;

        const content = await callAI(prompt, 2500);
        const cleaned = content.replace(/```json|```/g, '').trim();
        const comprehension = JSON.parse(cleaned);

        res.json({ success: true, comprehension });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
