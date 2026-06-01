import axios from 'axios';
import mongoose from 'mongoose';
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

const PQ_BASE = 'https://ng-pastquestions-api.onrender.com';

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

function resolveSubjectSlug(subject) {
    if (!subject) return null;
    const key = subject.trim().toLowerCase();
    return SUBJECT_SLUG_MAP[key] || key;
}

function mapToPqSubjectName(subject) {
    if (!subject) return null;
    const clean = subject.trim().toLowerCase();
    
    if (clean === 'english' || clean === 'english language') {
        return 'English Language';
    }
    if (clean === 'mathematics' || clean === 'maths' || clean === 'math') {
        return 'Mathematics';
    }
    if (clean === 'accounting') {
        return 'Financial Accounting';
    }
    if (clean === 'englishlit' || clean === 'english literature' || clean === 'literature') {
        return 'Literature in English';
    }
    if (clean === 'crk' || clean === 'christian religious knowledge') {
        return 'Christian Religious Knowledge';
    }
    if (clean === 'irk' || clean === 'islamic religious knowledge') {
        return 'Islamic Religious Knowledge';
    }
    if (clean === 'civiledu' || clean === 'civic education') {
        return 'Civic Education';
    }
    
    // Fallback: capitalize each word
    return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Test Connections
// ─────────────────────────────────────────────────────────────────────────────
export const testALOCConnection = async (req, res) => {
    const results = { pqApi: 'unknown' };
    
    try {
        // Test PQ API
        const pqResponse = await axios.get(`${PQ_BASE}/`, { timeout: 8000 });
        if (pqResponse.status === 200) {
            results.pqApi = 'reachable';
        } else {
            results.pqApi = `unreachable (status: ${pqResponse.status})`;
        }
    } catch (error) {
        results.pqApi = `error: ${error.message}`;
    }

    const pqReachable = results.pqApi === 'reachable';
    if (pqReachable) {
        return res.status(200).json({ status: 'success', message: 'PQ API reachable 🚀', results });
    }
    
    return res.status(502).json({ status: 'fail', message: 'Primary PQ API is unreachable', results });
};

// ── Shared: fetch questions (DB cache + PQ API) ──
export async function fetchCbtQuestionPack({ subject, type, year, amount = 10 }) {
    if (!subject) return { ok: false, httpStatus: 400, body: { error: 'subject is required.' } };

    const subjectSlug = resolveSubjectSlug(subject);
    if (!subjectSlug) return { ok: false, httpStatus: 400, body: { error: `"${subject}" is not recognised.` } };

    const clampedAmount = Math.min(Math.max(parseInt(amount, 10) || 10, 1), 100);

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

    const fetchFromPQ = async (targetSubject, targetYear = null) => {
        const params = new URLSearchParams();
        params.append('subject', targetSubject);
        if (targetYear && targetYear !== 'any') {
            params.append('year', targetYear);
        }

        const url = `${PQ_BASE}/questions?${params.toString()}`;
        console.log(`[PQ API Proxy] Attempting: ${url}`);

        try {
            const response = await axios.get(url, { timeout: 40000 });
            const data = response.data;
            if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
                return { ok: false, error: 'No questions returned from PQ API' };
            }
            return { ok: true, data };
        } catch (err) {
            console.error('PQ API failed:', err.message);
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
                        image: q.image || null,
                        topic: q.topic || null,
                        tested_word: q.tested_word || null
                    }))
                };
                break;
            }

            // Try PQ API
            const pqSubjectName = mapToPqSubjectName(subject);
            if (pqSubjectName) {
                const pqResult = await fetchFromPQ(pqSubjectName, year);
                if (pqResult.ok) {
                    const mappedQuestions = pqResult.data.questions.map(q => ({
                        id: q.no || q.id,
                        question: q.question,
                        option: {
                            a: q.options?.A || null,
                            b: q.options?.B || null,
                            c: q.options?.C || null,
                            d: q.options?.D || null,
                            e: q.options?.E || null
                        },
                        answer: q.answer,
                        solution: q.explanation || q.solution || null,
                        examType: targetType,
                        year: pqResult.data.year !== 'all' ? pqResult.data.year : (q.year || year || 'any'),
                        image: q.image || null,
                        topic: q.topic || null,
                        tested_word: q.tested_word || null
                    }));

                    const ops = mappedQuestions.map((q, i) => {
                        const opts = q.option ? Object.values(q.option).filter(v => v !== null && v !== undefined) : [];
                        return {
                            updateOne: {
                                filter: { subject: subjectSlug, examType: targetType, year: q.year, questionNumber: q.id || i + 1 },
                                update: {
                                    $setOnInsert: {
                                        subject: subjectSlug,
                                        examType: targetType,
                                        year: q.year,
                                        questionNumber: q.id || i + 1,
                                        questionText: q.question,
                                        options: opts,
                                        correctAnswer: q.answer,
                                        explanation: q.solution,
                                        image: q.image,
                                        topic: q.topic || null,
                                        tested_word: q.tested_word || null,
                                        source: 'API'
                                    }
                                },
                                upsert: true
                            }
                        };
                    });
                    await CBTQuestion.bulkWrite(ops, { ordered: false }).catch(() => { });

                    const shuffled = mappedQuestions.sort(() => 0.5 - Math.random());
                    finalData = {
                        status: true,
                        message: 'Questions from PQ API',
                        data: shuffled.slice(0, clampedAmount)
                    };
                    break;
                } else {
                    lastError = `PQ API failed: ${pqResult.error}`;
                }
            }
        }

        // Try PQ API for year === 'any' / null
        const pqSubjectName = mapToPqSubjectName(subject);
        if (pqSubjectName) {
            const pqResult = await fetchFromPQ(pqSubjectName, null);
            if (pqResult.ok) {
                const mappedQuestions = pqResult.data.questions.map(q => ({
                    id: q.no || q.id,
                    question: q.question,
                    option: {
                        a: q.options?.A || null,
                        b: q.options?.B || null,
                        c: q.options?.C || null,
                        d: q.options?.D || null,
                        e: q.options?.E || null
                    },
                    answer: q.answer,
                    solution: q.explanation || q.solution || null,
                    examType: targetType,
                    year: pqResult.data.year !== 'all' ? pqResult.data.year : (q.year || year || 'any'),
                    image: q.image || null,
                    topic: q.topic || null,
                    tested_word: q.tested_word || null
                }));

                const ops = mappedQuestions.map((q, i) => {
                    const opts = q.option ? Object.values(q.option).filter(v => v !== null && v !== undefined) : [];
                    return {
                        updateOne: {
                            filter: { subject: subjectSlug, examType: targetType, year: q.year, questionNumber: q.id || i + 1 },
                            update: {
                                $setOnInsert: {
                                    subject: subjectSlug,
                                    examType: targetType,
                                    year: q.year,
                                    questionNumber: q.id || i + 1,
                                    questionText: q.question,
                                    options: opts,
                                    correctAnswer: q.answer,
                                    explanation: q.solution,
                                    image: q.image,
                                    topic: q.topic || null,
                                    tested_word: q.tested_word || null,
                                    source: 'API'
                                }
                            },
                            upsert: true
                        }
                    };
                });
                await CBTQuestion.bulkWrite(ops, { ordered: false }).catch(() => { });

                const shuffled = mappedQuestions.sort(() => 0.5 - Math.random());
                finalData = {
                    status: true,
                    message: 'Questions from PQ API',
                    data: shuffled.slice(0, clampedAmount)
                };
                break;
            } else {
                lastError = `PQ API failed: ${pqResult.error}`;
            }
        }
    }

    if (!finalData) {
        return {
            ok: false,
            httpStatus: 404,
            body: {
                error: 'No questions found',
                message: `PQ API failed for ${subjectSlug} (${type} ${year}). Details: ${lastError}`
            }
        };
    }

    if (finalData.data && finalData.data[0]) {
        console.log(`[CBT Proxy] Sample question raw data (${finalData.message}):`, JSON.stringify(finalData.data[0], null, 2));
    }

    return { ok: true, finalData, subjectSlug, typesToTry, year, clampedAmount };
}

export const getQuestionsProxy = async (req, res) => {
    try {
        const { subject, type, year, amount = 10 } = req.validatedQuery || req.query;

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

// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT METADATA DISCOVERY & CACHING
// ─────────────────────────────────────────────────────────────────────────────
let metadataCache = null;
let lastMetadataFetch = 0;
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

// Static subject list — all confirmed supported by the PQ API.
// This avoids depending on slow parallel probes that can time out on Render.
const STATIC_SUBJECTS = [
    'English Language',
    'Mathematics',
    'Biology',
    'Chemistry',
    'Physics',
    'Economics',
    'Government',
    'Commerce',
    'Accounting',
    'Geography',
    'Literature in English',
    'Christian Religious Knowledge',
    'Islamic Religious Knowledge',
    'Civic Education',
    'Current Affairs',
    'History',
];

const STATIC_YEARS = [
    '2023', '2022', '2021', '2020', '2019',
    '2018', '2017', '2016', '2015', '2014',
    '2013', '2012', '2011', '2010', '2009',
    '2008', '2007', '2006', '2005', '2004',
    '2003', '2002', '2001',
];

async function fetchSubjectMetadata() {
    if (metadataCache && (Date.now() - lastMetadataFetch < CACHE_TTL)) {
        return metadataCache;
    }

    // Always return the static list immediately for reliability.
    // Optionally attempt a quick background probe to verify/extend it,
    // but we never block on it.
    metadataCache = {
        subjects: STATIC_SUBJECTS,
        years: STATIC_YEARS,
        examTypes: ['utme', 'wassce'],
    };
    lastMetadataFetch = Date.now();

    // Fire-and-forget: try to verify a sample subject so the API is warmed up
    axios.get(`${PQ_BASE}/questions?subject=English%20Language`, { timeout: 10000 })
        .catch(() => { /* ignore — static list is the source of truth */ });

    return metadataCache;
}

export const getAvailableSubjects = async (req, res) => {
    try {
        const metadata = await fetchSubjectMetadata();
        return res.status(200).json(metadata);
    } catch (error) {
        console.error('[CBT Metadata Fetch Error]:', error);
        return res.status(500).json({ error: 'Failed to fetch CBT metadata' });
    }
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

        const subjectSlug = resolveSubjectSlug(subject);
        const typesToTry = (t) => {
            if (!t) return ['utme', 'wassce'];
            const lower = t.toLowerCase();
            if (lower === 'jamb' || lower === 'utme') return ['utme'];
            if (lower === 'waec' || lower === 'wassce') return ['wassce'];
            if (lower === 'neco') return ['wassce', 'neco'];
            if (lower === 'bece') return ['wassce', 'bece'];
            return [lower];
        };
        const activeExamTypes = typesToTry(examType);

        let verifiedAnswers = [];
        let correctCount = 0;
        let attemptedCount = 0;

        // BOLA & Cheating Prevention: Verify each answer server-side
        if (clientAnswers && Array.isArray(clientAnswers)) {
            // PDF_CBT and AI_STUDY questions are not stored in CBTQuestion (ALOC DB),
            // so server-side DB lookup would always return empty — trust client isCorrect for these.
            const isPdfCbt = examType === 'PDF_CBT' || examType === 'AI_STUDY';

            for (const ans of clientAnswers) {
                if (isPdfCbt) {
                    // For AI-generated PDF CBT, we trust the client-side answers 
                    // because these questions aren't stored in the main question bank
                    const isCorrect = ans.isCorrect === true;
                    if (isCorrect) correctCount++;
                    if (ans.selectedAnswer && ans.selectedAnswer !== 'Skipped') attemptedCount++;

                    verifiedAnswers.push({
                        questionId: ans.questionId,
                        question: ans.question,
                        selectedAnswer: ans.selectedAnswer,
                        correctAnswer: ans.correctAnswer,
                        isCorrect,
                        explanation: ans.explanation || ''
                    });
                    continue;
                }

                // Standard Question Bank verification
                const question = await CBTQuestion.findOne({
                    subject: subjectSlug,
                    examType: { $in: activeExamTypes },
                    year: year,
                    $or: [
                        { _id: mongoose.Types.ObjectId.isValid(ans.questionId) ? ans.questionId : null },
                        { questionNumber: ans.questionId }
                    ]
                });

                if (question) {
                    const optionKeys = ['a', 'b', 'c', 'd', 'e'];
                    let correctText = '';
                    
                    if (typeof question.correctAnswer === 'string' && optionKeys.includes(question.correctAnswer.toLowerCase())) {
                        const idx = optionKeys.indexOf(question.correctAnswer.toLowerCase());
                        correctText = question.options[idx] || '';
                    } else if (!isNaN(parseInt(question.correctAnswer))) {
                        correctText = question.options[parseInt(question.correctAnswer)] || '';
                    } else {
                        correctText = question.correctAnswer;
                    }

                    const isCorrect = String(ans.selectedAnswer).toLowerCase() === String(correctText).toLowerCase();
                    if (isCorrect) correctCount++;
                    if (ans.selectedAnswer && ans.selectedAnswer !== 'Skipped') attemptedCount++;

                    verifiedAnswers.push({
                        questionId: ans.questionId,
                        question: question.questionText,
                        options: question.options,
                        selectedAnswer: ans.selectedAnswer,
                        correctAnswer: correctText,
                        isCorrect,
                        explanation: question.explanation
                    });
                }
            }
        }

        const totalGradable = verifiedAnswers.filter(a => typeof a.isCorrect === 'boolean').length;
        const total = totalQuestions || verifiedAnswers.length || 0;
        const accuracy = totalGradable > 0 ? Math.round((correctCount / totalGradable) * 100) : 0;

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
    const { question, correctAnswer, options = [], stream = false, subject = '' } = req.body;
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
                explanation: fullExplanation,
                subject: subject || ''
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
            explanation,
            subject: subject || ''
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

export const explainQuestionVote = async (req, res) => {
    try {
        const { question, correctAnswer, options = [], vote } = req.body;
        if (!question || !correctAnswer || !vote) {
            return res.status(400).json({ error: 'Missing required fields: question, correctAnswer, vote' });
        }
        if (vote !== 'up' && vote !== 'down') {
            return res.status(400).json({ error: 'Invalid vote. Must be "up" or "down".' });
        }

        const qHash = crypto.createHash('sha256')
            .update(`${question}|${correctAnswer}|${options.sort().join(',')}`)
            .digest('hex');

        const update = vote === 'up' ? { $inc: { upvotes: 1 } } : { $inc: { downvotes: 1 } };
        
        const cached = await ExplanationCache.findOneAndUpdate({ questionHash: qHash }, update, { new: true });
        if (!cached) {
            return res.status(404).json({ error: 'Explanation cache entry not found for this question.' });
        }

        return res.status(200).json({
            success: true,
            message: `Feedback recorded: ${vote}`,
            upvotes: cached.upvotes || 0,
            downvotes: cached.downvotes || 0
        });
    } catch (err) {
        console.error('[Explain Vote Error]:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
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
            const { subject, year, examType } = req.body;
            const subjectSlug = resolveSubjectSlug(subject);
            
            const question = await CBTQuestion.findOne({ 
                subject: subjectSlug,
                year: year,
                $or: [{ _id: mongoose.Types.ObjectId.isValid(questionId) ? questionId : null }, { questionNumber: questionId }]
            });
            
            if (!question) {
                return res.status(404).json({ error: 'Question not found in database. Please ensure you are taking a valid exam.' });
            }
            
            actualAnswer = question.correctAnswer;
            
            const optionKeys = ['a', 'b', 'c', 'd', 'e'];
            let correctText = '';
            if (typeof actualAnswer === 'string' && optionKeys.includes(actualAnswer.toLowerCase())) {
                const idx = optionKeys.indexOf(actualAnswer.toLowerCase());
                correctText = question.options[idx] || '';
            } else if (!isNaN(parseInt(actualAnswer))) {
                correctText = question.options[parseInt(actualAnswer)] || '';
            } else {
                correctText = actualAnswer;
            }

            // In Study Mode, the frontend might send the letter (A, B, C, D) or the text
            // If the selectedAnswer is a single letter, compare with actualAnswer (the letter)
            if (String(selectedAnswer).length === 1 && optionKeys.includes(String(selectedAnswer).toLowerCase())) {
                correct = String(selectedAnswer).toLowerCase() === String(actualAnswer).toLowerCase();
            } else {
                // Otherwise compare with the text
                correct = String(selectedAnswer).toLowerCase() === String(correctText).toLowerCase();
            }
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
