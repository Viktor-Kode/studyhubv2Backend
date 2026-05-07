import axios from 'axios';
import { getEnv } from '../config/env.js';
import CBTQuestion from '../models/CBTQuestion.js';
import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';
import ExplanationCache from '../models/ExplanationCache.js';
import aiClient from '../utils/aiClient.js';
import crypto from 'crypto';
import { MODEL_REGISTRY } from '../config/aiConfig.js';
import { updateStreak } from '../services/streakService.js';
import { sendNotification } from '../services/notificationService.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { awardXP } from './progressController.js';
import { logUserActivity } from '../services/activityService.js';
import { logPaywallEvent } from '../utils/paywallLogger.js';

const ALOC_BASE = 'https://questions.aloc.com.ng/api/v2';

// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT SLUG MAP
// ─────────────────────────────────────────────────────────────────────────────
const SUBJECT_SLUG_MAP = {
    'english language': 'english',
    'english': 'english',
    'mathematics': 'mathematics',
    'maths': 'mathematics',
    'math': 'mathematics',
    'commerce': 'commerce',
    'accounting': 'accounting',
    'biology': 'biology',
    'physics': 'physics',
    'chemistry': 'chemistry',
    'english literature': 'englishlit',
    'englishlit': 'englishlit',
    'literature': 'englishlit',
    'government': 'government',
    'crk': 'crk',
    'christian religious knowledge': 'crk',
    'geography': 'geography',
    'economics': 'economics',
    'irk': 'irk',
    'islamic religious knowledge': 'irk',
    'civic education': 'civiledu',
    'civiledu': 'civiledu',
    'insurance': 'insurance',
    'current affairs': 'currentaffairs',
    'currentaffairs': 'currentaffairs',
    'history': 'history',
};

const ALOC_MIN_YEAR = 2001;
const ALOC_MAX_YEAR = 2020;

function resolveSubjectSlug(subject) {
    if (!subject) return null;
    const key = subject.trim().toLowerCase();
    return SUBJECT_SLUG_MAP[key] || key;
}

function safeParseAlocResponse(response) {
    const rawData = response.data;
    if (typeof rawData === 'object' && rawData !== null) {
        return { ok: true, data: rawData };
    }
    if (typeof rawData === 'string') {
        const trimmed = rawData.trim();
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
            return { ok: false, error: 'ALOC returned HTML instead of JSON.', rawSnippet: trimmed.substring(0, 200) };
        }
        try {
            const parsed = JSON.parse(trimmed);
            return { ok: true, data: parsed };
        } catch {
            return { ok: false, error: 'ALOC returned non-JSON text.', rawSnippet: trimmed.substring(0, 200) };
        }
    }
    return { ok: false, error: 'Unrecognised response format from ALOC.', rawData };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Test ALOC Connection
// ─────────────────────────────────────────────────────────────────────────────
export const testALOCConnection = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');
    if (!token) {
        return res.status(503).json({ status: 'error', message: 'ALOC_ACCESS_TOKEN not configured' });
    }

    try {
        const testUrl = `${ALOC_BASE}/q/1?subject=chemistry&year=2010&type=utme`;
        const response = await axios.get(testUrl, {
            headers: { 'Accept': 'application/json', 'AccessToken': token },
            timeout: 8000,
        });

        const parsed = safeParseAlocResponse(response);
        if (!parsed.ok) return res.status(502).json({ status: 'fail', message: parsed.error });

        return res.status(200).json({ status: 'success', message: 'ALOC API reachable' });
    } catch (error) {
        return res.status(error.response?.status || 502).json({ status: 'fail', message: error.message });
    }
};

// ── Shared: fetch questions (DB cache + ALOC) — used by HTTP proxy and Group CBT ──
export async function fetchCbtQuestionPack({ subject, type, year, amount = 10 }) {
    const token = getEnv('ALOC_ACCESS_TOKEN');
    if (!token) return { ok: false, httpStatus: 503, body: { error: 'ALOC_ACCESS_TOKEN not configured' } };
    if (!subject) return { ok: false, httpStatus: 400, body: { error: 'subject is required.' } };

    const subjectSlug = resolveSubjectSlug(subject);
    if (!subjectSlug) return { ok: false, httpStatus: 400, body: { error: `"${subject}" is not recognised.` } };

    const clampedAmount = Math.min(Math.max(parseInt(amount, 10) || 10, 1), 40);

    const getExamTypesToTry = (t) => {
        if (!t) return ['utme', 'wassce'];
        const lower = t.toLowerCase();
        if (lower === 'jamb' || lower === 'utme') return ['utme'];
        if (lower === 'waec' || lower === 'wassce') return ['wassce'];
        if (lower === 'neco') return ['wassce', 'neco'];
        if (lower === 'bece') return ['wassce', 'bece'];
        return [lower];
    };

    const typesToTry = getExamTypesToTry(type);

    const fetchFromALOC = async (targetType, targetYear = null, attempt = 1) => {
        const params = new URLSearchParams({ subject: subjectSlug, type: targetType });
        if (targetYear && targetYear !== 'any' && attempt === 1) params.append('year', targetYear);

        const url = `${ALOC_BASE}/m/${clampedAmount}?${params.toString()}`;
        console.log(`[ALOC Proxy] Attempting: ${url}, attempt: ${attempt}`);

        try {
            const response = await axios.get(url, {
                headers: { 'Accept': 'application/json', 'AccessToken': token },
                timeout: 40000,
            });

            const parsed = safeParseAlocResponse(response);
            if (!parsed.ok) return { ok: false, error: parsed.error };

            const data = parsed.data;
            if (data.status === false || data.status === 0 || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
                return { ok: false, message: data.message || 'No data returned' };
            }
            return { ok: true, data };
        } catch (err) {
            console.error(`ALOC attempt ${attempt} failed:`, err.message);
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 2000));
                return fetchFromALOC(targetType, null, attempt + 1);
            }
            return { ok: false, error: err.message };
        }
    };

    let finalData = null;
    let lastError = 'No questions found';

    for (const targetType of typesToTry) {
        if (year && year !== 'any') {
            const cached = await CBTQuestion.find({ subject: subjectSlug, examType: targetType, year }).limit(clampedAmount);
            if (cached.length >= clampedAmount) {
                console.log(`✅ Served from cache: ${subjectSlug} (${targetType} ${year})`);
                finalData = {
                    status: true,
                    message: 'Questions from cache',
                    data: cached.map(q => ({
                        id: q.questionNumber,
                        question: q.questionText,
                        option: { a: q.options[0], b: q.options[1], c: q.options[2], d: q.options[3], e: q.options[4] },
                        answer: q.correctAnswer,
                        solution: q.explanation,
                        examType: q.examType,
                        year: q.year,
                        image: q.image || null
                    }))
                };
                break;
            }

            const result = await fetchFromALOC(targetType, year);
            if (result.ok) {
                finalData = result.data;
                break;
            }
            lastError = result.message || result.error;
        }

        const result = await fetchFromALOC(targetType, null);
        if (result.ok) {
            finalData = result.data;
            break;
        }
        lastError = result.message || result.error;
    }

    if (!finalData) {
        return {
            ok: false,
            httpStatus: 404,
            body: {
                error: 'No questions found',
                message: `ALOC failed for ${subjectSlug} (${type} ${year}). Details: ${lastError}`
            }
        };
    }

    if (finalData.data && finalData.data[0]) {
        console.log('[ALOC] Sample question raw data:', JSON.stringify(finalData.data[0], null, 2));
    }

    // Mask sensitive info (BOLA & Cheating prevention)
    const maskQuestions = (qs) => qs.map(q => {
        const { answer, solution, explanation, correctAnswer, ...rest } = q;
        return rest;
    });

    const ops = finalData.data.map((q, i) => {
        const opts = q.option ? Object.values(q.option).filter(v => v !== null && v !== undefined) : [];
        const qYear = q.year || year || 'any';
        const qType = q.examType || typesToTry[0];

        const explanation = q.solution || q.explanation || q.note || q.discussion ||
            q.answer_explanation || q.knowledge_deep_dive ||
            q.knowledgeDeepDive || q.modelAnswer || q.reason || null;

        const image =
            q.image ||
            q.diagram ||
            q.img ||
            q.image_url ||
            q.imageUrl ||
            q.questionImage ||
            q.picture ||
            q.figure ||
            q.image_link ||
            null;

        return {
            updateOne: {
                filter: { subject: subjectSlug, examType: qType, year: qYear, questionNumber: q.id || i + 1 },
                update: {
                    $setOnInsert: {
                        subject: subjectSlug,
                        examType: qType,
                        year: qYear,
                        questionNumber: q.id || i + 1,
                        questionText: q.question,
                        options: opts,
                        correctAnswer: q.answer,
                        explanation: explanation,
                        image,
                        source: 'API'
                    }
                },
                upsert: true
            }
        };
    });

    await CBTQuestion.bulkWrite(ops, { ordered: false }).catch(() => { });

    return { ok: true, finalData, subjectSlug, typesToTry, year, clampedAmount };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get Questions Proxy (Database-First Cache)
// ─────────────────────────────────────────────────────────────────────────────
export const getQuestionsProxy = async (req, res) => {
    try {
        const { subject, type, year, amount = 10 } = req.query;
        const result = await fetchCbtQuestionPack({ subject, type, year, amount });
        if (!result.ok) {
            return res.status(result.httpStatus || 500).json(result.body || { error: 'Unknown error' });
        }

        // Strip answers before sending to frontend
        const maskedData = {
            ...result.finalData,
            data: result.finalData.data.map(q => {
                const { answer, solution, explanation, ...rest } = q;
                return rest;
            })
        };

        return res.status(200).json(maskedData);
    } catch (error) {
        console.error('[CBT Controller Internal Error]:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
};

export const getAvailableSubjects = (req, res) => {
    const unique = [...new Set(Object.values(SUBJECT_SLUG_MAP))];
    return res.status(200).json({
        subjects: unique,
        yearRange: `${ALOC_MIN_YEAR}–${ALOC_MAX_YEAR}`,
        examTypes: ['utme', 'wassce', 'post-utme'],
    });
};

export const saveCBTResult = async (req, res) => {
    try {
        const studentId = req.user._id;
        const { 
            subject, 
            examType, 
            year, 
            totalQuestions, 
            answers: clientAnswers,
            timeTaken,
            studyGroupId 
        } = req.body;

        let verifiedAnswers = [];
        let correctCount = 0;
        let attemptedCount = 0;

        // BOLA & Cheating Prevention: Verify each answer server-side
        if (clientAnswers && Array.isArray(clientAnswers)) {
            for (const ans of clientAnswers) {
                // Find question in DB
                const question = await CBTQuestion.findOne({
                    $or: [
                        { _id: mongoose.Types.ObjectId.isValid(ans.questionId) ? ans.questionId : null },
                        { questionNumber: ans.questionId }
                    ]
                });

                if (question) {
                    const isCorrect = String(ans.selectedAnswer).toLowerCase() === String(question.correctAnswer).toLowerCase();
                    if (isCorrect) correctCount++;
                    if (ans.selectedAnswer && ans.selectedAnswer !== 'Skipped') attemptedCount++;

                    verifiedAnswers.push({
                        questionId: ans.questionId,
                        question: question.questionText,
                        selectedAnswer: ans.selectedAnswer,
                        correctAnswer: question.correctAnswer,
                        isCorrect,
                        explanation: question.explanation
                    });
                }
            }
        }

        const total = totalQuestions || verifiedAnswers.length || 0;
        const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

        const resultData = {
            studentId,
            subject,
            examType,
            year,
            totalQuestions: total,
            correctAnswers: correctCount,
            wrongAnswers: attemptedCount - correctCount,
            skipped: total - attemptedCount,
            accuracy,
            timeTaken,
            answers: verifiedAnswers,
            takenAt: new Date()
        };

        const newResult = new CBTResult(resultData);
        await newResult.save();

        console.log(`[CBT] Saved VERIFIED result for user ${studentId}, accuracy: ${accuracy}%`);

        await logUserActivity({
            userId: studentId,
            type: 'cbt_result',
            title: `${newResult.subject || 'CBT'} practice completed`,
            subtitle: `${newResult.accuracy ?? 0}% score in ${newResult.examType || 'CBT'} (${newResult.totalQuestions || 0} questions)`,
            color: 'emerald',
            metadata: {
                resultId: String(newResult._id),
                subject: newResult.subject || null,
                examType: newResult.examType || null
            }
        });

        // Increment test usage
        await User.findByIdAndUpdate(studentId, { $inc: { 'plan.testsUsed': 1 } });

        const uidStr = String(studentId);
        await awardXP(uidStr, 'cbt_complete');
        if (accuracy >= 80) {
            await awardXP(uidStr, 'cbt_high_score');
        }

        // Community points
        const cbtCommunityPoints = accuracy >= 80 ? 10 : 5;
        const user = await User.findById(studentId);
        if (user) {
            user.cbtPoints = (user.cbtPoints || 0) + cbtCommunityPoints;
            user.totalPoints = (user.communityPoints || 0) + user.cbtPoints;
            await user.save({ validateBeforeSave: false });
        }

        if (studyGroupId && req.user?.firebaseUid) {
          const { awardStudyGroupCbtCompletion } = await import('../services/studyGroupCbtBonus.js');
          await awardStudyGroupCbtCompletion(req.user.firebaseUid, studyGroupId);
        }

        const streak = await updateStreak(studentId, 'cbt');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
        const lastDate = streak?.lastActivityDate
            ? new Date(streak.lastActivityDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
            : null;

        if (req.user?.firebaseUid) {
          void sendNotification({
            userId: req.user.firebaseUid,
            type: 'cbt_result',
            title: `CBT Result: ${correctCount}/${total} (${accuracy}%)`,
            body: `You scored ${accuracy}% in ${subject}. ${accuracy >= 50 ? 'Great job! 🎉' : 'Keep practicing! 💪'}`,
            icon: '📝',
            link: '/dashboard/cbt',
            data: { subject },
          });
        }

        res.status(201).json({
            status: 'success',
            data: newResult,
            streak: streak ? {
                current: streak.currentStreak || 0,
                longest: streak.longestStreak || 0,
                studiedToday: lastDate === today
            } : null
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to save result' });
    }
};

export const getCBTResultsSummary = async (req, res) => {
    try {
        const studentId = req.user._id;
        const results = await CBTResult.find({ studentId }).sort({ takenAt: -1 }).limit(50);

        if (results.length === 0) {
            return res.status(200).json({
                overallAccuracy: 0, examsTaken: 0, bestSubject: 'N/A', weakestSubject: 'N/A', recentResults: []
            });
        }

        const totalAccuracy = results.reduce((acc, curr) => acc + (Number(curr.accuracy) || 0), 0);
        const overallAccuracy = Math.round(totalAccuracy / results.length);

        const subjectStats = {};
        results.forEach(res => {
            if (!subjectStats[res.subject]) subjectStats[res.subject] = { total: 0, count: 0 };
            subjectStats[res.subject].total += res.accuracy;
            subjectStats[res.subject].count += 1;
        });

        let bestSubject = 'N/A', bestAcc = -1, weakestSubject = 'N/A', weakestAcc = 101;
        Object.keys(subjectStats).forEach(subject => {
            const avg = subjectStats[subject].total / subjectStats[subject].count;
            if (avg > bestAcc) { bestAcc = avg; bestSubject = subject; }
            if (avg < weakestAcc) { weakestAcc = avg; weakestSubject = subject; }
        });

        res.status(200).json({
            overallAccuracy, examsTaken: results.length, bestSubject, weakestSubject, recentResults: results.slice(0, 5)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch summary' });
    }
};

export const getCBTResults = async (req, res) => {
    try {
        const studentId = req.user._id;
        const results = await CBTResult.find({ studentId }).sort({ takenAt: -1 });
        res.status(200).json({ status: 'success', data: results });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch results' });
    }
};

export const explainQuestion = async (req, res) => {
    const { question, correctAnswer, options = [], stream = false } = req.body;
    if (!question || !correctAnswer) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }

    try {
        const studentId = req.user._id;
        const qHash = crypto.createHash('sha256')
            .update(`${question}|${correctAnswer}|${options.sort().join(',')}`)
            .digest('hex');

        // 2. Check Cache First (Doesn't cost a credit)
        const cached = await ExplanationCache.findOne({ questionHash: qHash });
        if (cached) {
            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.write(`data: ${JSON.stringify({ content: cached.explanation })}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
            }
            return res.status(200).json({ status: 'success', explanation: cached.explanation });
        }

        // 3. Generate New Explanation (Limit already checked by middleware)
        const selectedModel = MODEL_REGISTRY.find(m => m.recommended) || MODEL_REGISTRY[0];

        const typeDesc = options.length > 0 ? "Multiple Choice" : "Fill-in-the-blank";
        const optionsText = options.length > 0 ? `Options: ${options.join(', ')}` : "";

        const prompt = `Act as an expert tutor. Provide an educational explanation for this ${typeDesc} question.
        
        Question: ${question}
        ${optionsText}
        Correct Answer: ${correctAnswer}
        
        Instruction: Briefly explain (in 3-4 sentences) why "${correctAnswer}" is the correct answer. 
        Focus on the core concept and logic. Help the student understand the principle so they don't make similar mistakes.`;

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamResponse = await aiClient.chatCompletion({
                model: selectedModel.id,
                messages: [{ role: "user", content: prompt }],
                max_tokens: 400,
                temperature: 0.5,
                stream: true
            });

            let fullExplanation = '';
            for await (const chunk of streamResponse) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    fullExplanation += content;
                    res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
            }

            // Save to Cache after streaming
            await ExplanationCache.create({
                questionHash: qHash,
                questionText: question,
                correctAnswer,
                explanation: fullExplanation
            });

            await incrementAIUsage(studentId);
            res.write('data: [DONE]\n\n');
            return res.end();
        }

        const response = await aiClient.chatCompletion({
            model: selectedModel.id,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 250,
            temperature: 0.5,
        });

        const explanation = response.choices[0].message.content.trim();

        // 4. Save to Cache
        await ExplanationCache.create({
            questionHash: qHash,
            questionText: question,
            correctAnswer,
            explanation
        });

        // 5. Increment AI usage (one credit per new explanation)
        await incrementAIUsage(studentId);

        return res.status(200).json({ status: 'success', explanation });
    } catch (error) {
        console.error('Explanation Error:', error);
        if (stream && !res.headersSent) {
            return res.status(500).json({ error: 'Failed to generate explanation', details: error.message });
        } else if (stream) {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            return res.end();
        }
        res.status(500).json({ error: 'Failed to generate explanation', details: error.message });
    }
};

/**
 * AI-generated MCQs for a syllabus topic (DeepSeek via aiClient).
 */
export const generateTopicQuestions = async (req, res) => {
    const { exam, subject, topic, count = 5 } = req.body;

    if (!exam || !subject || !topic) {
        return res.status(400).json({ error: 'exam, subject, and topic are required' });
    }

    const n = Math.min(20, Math.max(1, parseInt(String(count), 10) || 5));
    const examLabel = String(exam).toUpperCase();

    const prompt = `Generate ${n} multiple choice questions for Nigerian ${examLabel} exam on the topic "${topic}" in ${subject}.

Requirements:
- Questions must be exam-standard, similar to real ${examLabel} past questions
- Each question must have exactly 4 options (A, B, C, D)
- Include the correct answer as a single letter A, B, C, or D
- Include a brief explanation
- Based strictly on the Nigerian ${examLabel} syllabus

Return ONLY a valid JSON array with no extra text, markdown fences, or backticks, in this format:
[
  {
    "question": "question text here",
    "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "answer": "A",
    "explanation": "brief explanation of why the answer is correct"
  }
]`;

    try {
        console.log('[CBT] generate-topic-questions', { exam: examLabel, subject, topic: String(topic).slice(0, 80), n });
        const selectedModel = MODEL_REGISTRY.find((m) => m.recommended) || MODEL_REGISTRY[0];

        const response = await aiClient.chatCompletion({
            model: selectedModel.id,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4000,
            temperature: 0.7,
        });

        const text = response.choices[0].message.content.trim();
        const clean = text
            .replace(/```json\s*/gi, '')
            .replace(/```\s*$/g, '')
            .trim();

        let questions;
        try {
            questions = JSON.parse(clean);
        } catch {
            const match = clean.match(/\[[\s\S]*\]/);
            if (!match) throw new Error('Could not parse JSON array from model output');
            questions = JSON.parse(match[0]);
        }

        if (!Array.isArray(questions)) {
            return res.status(502).json({ error: 'Invalid AI response: expected a JSON array' });
        }

        // Save generated questions to DB for server-side verification
        const savedQuestions = await Promise.all(questions.map(async (q, i) => {
            const questionId = `ai_${Date.now()}_${i}`;
            // We use ExplanationCache or a dedicated AIQuestion model? 
            // Let's use ExplanationCache to store the answer as well for simplicity
            await ExplanationCache.create({
                questionHash: crypto.createHash('sha256').update(q.question).digest('hex'),
                questionText: q.question,
                correctAnswer: q.answer,
                explanation: q.explanation
            });
            return {
                id: questionId,
                question: q.question,
                options: q.options,
                // answer and explanation are STRIPPED here
            };
        }));

        await incrementAIUsage(req.user._id, savedQuestions.length);

        return res.status(200).json({ questions: savedQuestions });
    } catch (err) {
        console.error('[Topic Questions]', err);
        return res.status(500).json({ error: err.message || 'Failed to generate questions' });
    }
};

// ── NEW: Server-side Answer Verification ─────────────────────────────────────
export const verifyAnswer = async (req, res) => {
    try {
        const { questionId, selectedAnswer, questionText, isAiGenerated } = req.body;
        
        let correct = false;
        let explanation = '';
        let actualAnswer = '';

        if (isAiGenerated) {
            const qHash = crypto.createHash('sha256').update(questionText).digest('hex');
            const cached = await ExplanationCache.findOne({ questionHash: qHash });
            if (!cached) return res.status(404).json({ error: 'Question data lost. Please regenerate.' });
            
            actualAnswer = cached.correctAnswer;
            correct = String(selectedAnswer).toUpperCase() === String(actualAnswer).toUpperCase();
            explanation = cached.explanation;
        } else {
            // ALOC / Cached DB Question
            const question = await CBTQuestion.findOne({ 
                $or: [{ _id: mongoose.Types.ObjectId.isValid(questionId) ? questionId : null }, { questionNumber: questionId }]
            });
            
            if (!question) {
                // If not in DB, we might need to fetch from ALOC again? 
                // For now, assume it's in DB because fetchCbtQuestionPack upserts.
                return res.status(404).json({ error: 'Question not found' });
            }
            
            actualAnswer = question.correctAnswer;
            correct = String(selectedAnswer).toLowerCase() === String(actualAnswer).toLowerCase();
            explanation = question.explanation;
        }

        res.json({
            success: true,
            correct,
            actualAnswer,
            explanation
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
