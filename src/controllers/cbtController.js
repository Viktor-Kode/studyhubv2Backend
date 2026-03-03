import axios from 'axios';
import { getEnv } from '../config/env.js';
import CBTQuestion from '../models/CBTQuestion.js';
import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';
import ExplanationCache from '../models/ExplanationCache.js';
import aiClient from '../utils/aiClient.js';
import crypto from 'crypto';
import { MODEL_REGISTRY } from '../config/aiConfig.js';
import { updateStreak } from '../utils/streakUtils.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get Questions Proxy (Database-First Cache)
// ─────────────────────────────────────────────────────────────────────────────
export const getQuestionsProxy = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');
    if (!token) return res.status(503).json({ error: 'ALOC_ACCESS_TOKEN not configured' });

    const { subject, type, year, amount = 10 } = req.query;
    if (!subject) return res.status(400).json({ error: 'subject is required.' });

    const subjectSlug = resolveSubjectSlug(subject);
    if (!subjectSlug) return res.status(400).json({ error: `"${subject}" is not recognised.` });

    const clampedAmount = Math.min(Math.max(parseInt(amount, 10) || 10, 1), 40);

    // ── 0. Exam Type Mapping ──────────────────────────────────────────────
    const getExamTypesToTry = (t) => {
        if (!t) return ['utme', 'wassce'];
        const lower = t.toLowerCase();
        if (lower === 'jamb' || lower === 'utme') return ['utme'];
        if (lower === 'waec' || lower === 'wassce') return ['wassce'];
        if (lower === 'neco') return ['wassce', 'neco']; // Try wassce first, then neco
        if (lower === 'bece') return ['wassce', 'bece']; // Most junior exams can fallback to secondary level
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
                console.log(`Retrying without year filter...`);
                await new Promise(r => setTimeout(r, 2000));
                return fetchFromALOC(targetType, null, attempt + 1);
            }
            return { ok: false, error: err.message };
        }
    };

    try {
        let finalData = null;
        let lastError = 'No questions found';

        // Attempt Loop: Try all mapped types, then try random if year-specific fails
        for (const targetType of typesToTry) {
            // 1. Try with Year
            if (year && year !== 'any') {
                // Check Cache first
                const cached = await CBTQuestion.find({ subject: subjectSlug, examType: targetType, year }).limit(clampedAmount);
                if (cached.length >= clampedAmount) {
                    console.log(`✅ Served from cache: ${subjectSlug} (${targetType} ${year})`);
                    return res.status(200).json({
                        status: true,
                        message: "Questions from cache",
                        data: cached.map(q => ({
                            id: q.questionNumber,
                            question: q.questionText,
                            option: { a: q.options[0], b: q.options[1], c: q.options[2], d: q.options[3], e: q.options[4] },
                            answer: q.correctAnswer,
                            solution: q.explanation,
                            examType: q.examType,
                            year: q.year
                        }))
                    });
                }

                const result = await fetchFromALOC(targetType, year);
                if (result.ok) {
                    finalData = result.data;
                    break;
                }
                lastError = result.message || result.error;
            }

            // 2. Try Random (No Year)
            const result = await fetchFromALOC(targetType, null);
            if (result.ok) {
                finalData = result.data;
                break;
            }
            lastError = result.message || result.error;
        }

        if (!finalData) {
            return res.status(404).json({
                error: 'No questions found',
                message: `ALOC failed for ${subjectSlug} (${type} ${year}). Details: ${lastError}`
            });
        }

        // 3. Cache and serve
        const ops = finalData.data.map((q, i) => {
            const opts = q.option ? Object.values(q.option).filter(v => v !== null && v !== undefined) : [];
            const qYear = q.year || year || 'any';
            const qType = q.examType || typesToTry[0];

            // Robust explanation/deep-dive mapping
            const explanation = q.solution || q.explanation || q.note || q.discussion ||
                q.answer_explanation || q.knowledge_deep_dive ||
                q.knowledgeDeepDive || q.modelAnswer || q.reason || null;

            return {
                updateOne: {
                    filter: { subject: subjectSlug, examType: qType, year: qYear, questionNumber: q.id || i + 1 },
                    update: {
                        $setOnInsert: {
                            subject: subjectSlug, examType: qType, year: qYear, questionNumber: q.id || i + 1,
                            questionText: q.question, options: opts, correctAnswer: q.answer,
                            explanation: explanation, source: 'API'
                        }
                    },
                    upsert: true
                }
            };
        });

        await CBTQuestion.bulkWrite(ops, { ordered: false }).catch(() => { });

        return res.status(200).json(finalData);

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
        const resultData = { ...req.body, studentId };

        // Ensure accuracy is a number
        if (resultData.accuracy !== undefined) {
            resultData.accuracy = Number(resultData.accuracy);
        }

        console.log(`[CBT] Saving result for user ${studentId}, accuracy: ${resultData.accuracy}%`);

        const newResult = new CBTResult(resultData);
        await newResult.save();

        // Increment test usage
        await User.findByIdAndUpdate(studentId, { $inc: { 'plan.testsUsed': 1 } });

        await updateStreak(studentId, 'cbt');

        res.status(201).json({ status: 'success', data: newResult });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to save result' });
    }
};

export const getCBTResultsSummary = async (req, res) => {
    try {
        const studentId = req.query.studentId || req.user._id;
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
    const { question, correctAnswer, options } = req.body;
    if (!question || !correctAnswer || !options) {
        return res.status(400).json({ status: 'error', message: 'Missing fields' });
    }

    try {
        const qHash = crypto.createHash('sha256')
            .update(`${question}|${correctAnswer}|${options.sort().join(',')}`)
            .digest('hex');

        const cached = await ExplanationCache.findOne({ questionHash: qHash });
        if (cached) return res.status(200).json({ status: 'success', explanation: cached.explanation });

        const selectedModel = MODEL_REGISTRY.find(m => m.recommended) || MODEL_REGISTRY[0];
        const prompt = `Act as an expert tutor. I need a clear, educational explanation for this question.
        
        Question: ${question}
        Options: ${options.join(', ')}
        Correct Answer: ${correctAnswer}
        
        Instruction: Provide a 3-4 sentence explanation of why "${correctAnswer}" is the correct answer. Focus on the underlying concept and help the student understand the logic or rule behind it. If it involves a calculation, explain the steps briefly.`;

        const response = await aiClient.chatCompletion({
            model: selectedModel.id,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
            temperature: 0.5,
        });

        const explanation = response.choices[0].message.content.trim();

        await ExplanationCache.create({
            questionHash: qHash,
            questionText: question,
            correctAnswer,
            explanation
        });

        await User.findByIdAndUpdate(req.user._id, { $inc: { 'plan.aiExplanationsUsed': 1 } });
        res.status(200).json({ status: 'success', explanation });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate explanation' });
    }
};

