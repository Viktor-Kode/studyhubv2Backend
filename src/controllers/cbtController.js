import axios from 'axios';
import { getEnv } from '../config/env.js';
import CBTQuestion from '../models/CBTQuestion.js';
import User from '../models/User.js';
import CBTResult from '../models/CBTResult.js';
import ExplanationCache from '../models/ExplanationCache.js';
import aiClient from '../utils/aiClient.js';
import crypto from 'crypto';
import { MODEL_REGISTRY } from '../config/aiConfig.js';

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

    // ── 0. Map Exam Type ──────────────────────────────────────────────────
    // ALOC v2 only supports: utme, wassce, post-utme
    // See: https://github.com/Seunope/aloc-endpoints/wiki/API-Parameters
    let resolvedType = 'utme'; // Default
    if (type) {
        const t = type.toLowerCase();
        if (t === 'jamb' || t === 'utme') resolvedType = 'utme';
        else if (t === 'waec' || t === 'wassce' || t === 'neco') resolvedType = 'wassce';
        else if (t === 'post-utme') resolvedType = 'post-utme';
        else resolvedType = t; // try as is
    }

    try {
        // 1. Check DB Cache
        const query = { subject: subjectSlug, examType: resolvedType };
        if (year) query.year = year;

        const cached = await CBTQuestion.find(query).limit(clampedAmount);

        if (cached.length >= clampedAmount) {
            console.log(`✅ Served ${clampedAmount} questions from DB cache`);
            return res.status(200).json({
                status: true,
                message: "Questions from cache",
                data: cached.map(q => ({
                    id: q.questionNumber,
                    question: q.questionText,
                    option: {
                        a: q.options[0],
                        b: q.options[1],
                        c: q.options[2],
                        d: q.options[3],
                        e: q.options[4]
                    },
                    answer: q.correctAnswer,
                    solution: q.explanation,
                    examType: q.examType,
                    year: q.year
                }))
            });
        }

        // 2. Fetch from ALOC
        const params = new URLSearchParams({ subject: subjectSlug, type: resolvedType });
        if (year) params.append('year', year);

        const url = `${ALOC_BASE}/m/${clampedAmount}?${params.toString()}`;
        console.log(`[ALOC Proxy] Fetching: ${url}`);

        try {
            const response = await axios.get(url, {
                headers: { 'Accept': 'application/json', 'AccessToken': token },
                timeout: 10000,
            });

            const parsed = safeParseAlocResponse(response);
            if (!parsed.ok) return res.status(502).json({ error: parsed.error, message: 'ALOC response parse failed' });

            const data = parsed.data;
            if (data.status === false || data.status === 0) {
                return res.status(404).json({
                    error: 'ALOC returned no questions',
                    message: data.message || 'No data found for this combination.'
                });
            }

            // 3. Cache to DB
            if (data.data && Array.isArray(data.data)) {
                const ops = data.data.map((q, i) => {
                    const opts = q.option ? Object.values(q.option).filter(v => v !== null && v !== undefined) : [];
                    return {
                        updateOne: {
                            filter: {
                                subject: subjectSlug,
                                examType: resolvedType,
                                year: year || 'any',
                                questionNumber: q.id || i + 1
                            },
                            update: {
                                $setOnInsert: {
                                    subject: subjectSlug,
                                    examType: resolvedType,
                                    year: year || 'any',
                                    questionNumber: q.id || i + 1,
                                    questionText: q.question,
                                    options: opts,
                                    correctAnswer: q.answer,
                                    explanation: q.solution || null,
                                    source: 'API'
                                }
                            },
                            upsert: true
                        }
                    };
                });

                await CBTQuestion.bulkWrite(ops, { ordered: false }).catch(err => {
                    if (!err.message.includes('E11000')) console.error('[ALOC Cache] Bulk error:', err.message);
                });
            }

            return res.status(200).json(data);

        } catch (axiosErr) {
            const status = axiosErr.response?.status || 500;
            const alocMsg = axiosErr.response?.data?.message || axiosErr.message;
            console.error(`[ALOC API Error] ${status}: ${alocMsg}`);

            return res.status(status).json({
                error: 'ALOC API request failed',
                message: alocMsg,
                debug: { status, url }
            });
        }

    } catch (error) {
        console.error('[CBT Controller Internal Error]:', error);
        return res.status(500).json({ error: 'Internal server error processing questions' });
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

        const newResult = new CBTResult(resultData);
        await newResult.save();

        // Increment test usage
        await User.findByIdAndUpdate(studentId, { $inc: { 'plan.testsUsed': 1 } });

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

        const totalAccuracy = results.reduce((acc, curr) => acc + curr.accuracy, 0);
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
        const prompt = `Question: ${question}\nOptions: ${options.join(', ')}\nCorrect Answer: ${correctAnswer}\nGive a short, clear explanation of why "${correctAnswer}" is correct.`;

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
