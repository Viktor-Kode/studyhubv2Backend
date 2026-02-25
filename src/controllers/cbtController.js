import axios from 'axios';
import { getEnv } from '../config/env.js';
import CBTResult from '../models/CBTResult.js';
import ExplanationCache from '../models/ExplanationCache.js';
import aiClient from '../utils/aiClient.js';
import crypto from 'crypto';
import { MODEL_REGISTRY } from '../config/aiConfig.js';

const ALOC_BASE = 'https://questions.aloc.com.ng/api/v2';

// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT SLUG MAP
// ALOC requires lowercase slugs — NOT display names like "English Language"
// Official supported slugs: https://github.com/Seunope/aloc-endpoints/wiki/API-Parameters
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

// ─────────────────────────────────────────────────────────────────────────────
// YEAR VALIDATION
// ALOC only has questions from 2001 to ~2020. Year 2025 does NOT exist.
// Requesting a non-existent year causes the API to return an HTML error page.
// ─────────────────────────────────────────────────────────────────────────────
const ALOC_MIN_YEAR = 2001;
const ALOC_MAX_YEAR = 2020;

/**
 * Resolve a user-supplied subject name to the ALOC slug.
 * Returns null if the subject is not supported.
 */
function resolveSubjectSlug(subject) {
    if (!subject) return null;
    const key = subject.trim().toLowerCase();
    return SUBJECT_SLUG_MAP[key] || key; // fall through with original lowercased value
}

/**
 * Safely parse the response body of an axios response.
 * Axios already parsed JSON for us if Content-Type was application/json.
 * But if the API returned HTML (error page) we'll catch it here.
 */
function safeParseAlocResponse(response) {
    const contentType = response.headers['content-type'] || '';
    const rawData = response.data;

    // If axios already parsed JSON, use it directly
    if (typeof rawData === 'object' && rawData !== null) {
        return { ok: true, data: rawData };
    }

    // If it's a string, check if it looks like HTML
    if (typeof rawData === 'string') {
        const trimmed = rawData.trim();
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
            return {
                ok: false,
                error: 'ALOC returned an HTML page instead of JSON. ' +
                    'This usually means: (1) the endpoint URL is wrong, ' +
                    '(2) the subject/year combination has no data, or ' +
                    '(3) your Access Token is invalid/expired.',
                rawSnippet: trimmed.substring(0, 200),
            };
        }

        // Try manual JSON parse
        try {
            const parsed = JSON.parse(trimmed);
            return { ok: true, data: parsed };
        } catch {
            return {
                ok: false,
                error: 'ALOC returned non-JSON text.',
                rawSnippet: trimmed.substring(0, 200),
            };
        }
    }

    return { ok: false, error: 'Unrecognised response format from ALOC.', rawData };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Test ALOC Connection
// GET /api/cbt/test
// ─────────────────────────────────────────────────────────────────────────────
export const testALOCConnection = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');

    if (!token) {
        return res.status(503).json({
            status: 'error',
            service: 'ALOC',
            message: 'ALOC_ACCESS_TOKEN not configured on server',
        });
    }

    try {
        // Use a single-question endpoint with a known safe subject/year combo
        const testUrl = `${ALOC_BASE}/q/1?subject=chemistry&year=2010&type=utme`;

        console.log(`[ALOC Test] Hitting: ${testUrl}`);

        const response = await axios.get(testUrl, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'AccessToken': token,
            },
            timeout: 8000,
        });

        const parsed = safeParseAlocResponse(response);

        if (!parsed.ok) {
            return res.status(502).json({
                status: 'fail',
                service: 'ALOC',
                message: parsed.error,
                snippet: parsed.rawSnippet,
            });
        }

        return res.status(200).json({
            status: 'success',
            service: 'ALOC',
            message: 'ALOC API reachable and returning valid JSON',
            httpStatus: response.status,
            alocStatus: parsed.data?.status,
        });

    } catch (error) {
        const statusCode = error.response?.status || 502;
        const rawBody = error.response?.data;

        console.error('[ALOC Test] Error:', statusCode, error.message);

        // Detect HTML error page in the axios error response too
        if (typeof rawBody === 'string' && rawBody.trim().startsWith('<!DOCTYPE')) {
            return res.status(statusCode).json({
                status: 'fail',
                service: 'ALOC',
                message: `ALOC returned an HTML error page (HTTP ${statusCode}). Check token and endpoint.`,
            });
        }

        return res.status(statusCode).json({
            status: 'fail',
            service: 'ALOC',
            message: 'Failed to connect to ALOC API: ' + error.message,
            details: rawBody || null,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get Questions Proxy
// GET /api/cbt/questions?subject=english language&type=utme&year=2015&amount=10
//
// IMPORTANT NOTES FOR FRONTEND:
//   - subject: accepts display names (e.g "English Language") – we map to slugs
//   - type:    use "utme" for JAMB, "wassce" for WAEC (NOT "JAMB 2025")
//   - year:    must be between 2001–2020. Year 2025 does NOT exist in ALOC.
//   - amount:  max 40 per request
// ─────────────────────────────────────────────────────────────────────────────
export const getQuestionsProxy = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');

    if (!token) {
        return res.status(503).json({
            error: 'CBT service unavailable',
            message: 'ALOC_ACCESS_TOKEN not configured on server',
        });
    }

    const { subject, type, year, amount = 10 } = req.query;

    // ── 1. Subject validation ──────────────────────────────────────────────
    if (!subject) {
        return res.status(400).json({
            error: 'Missing required parameter',
            message: 'subject is required. e.g. ?subject=english language',
        });
    }

    const subjectSlug = resolveSubjectSlug(subject);
    if (!subjectSlug) {
        return res.status(400).json({
            error: 'Unsupported subject',
            message: `"${subject}" is not a recognised ALOC subject.`,
            supportedSubjects: Object.values(SUBJECT_SLUG_MAP).filter((v, i, a) => a.indexOf(v) === i),
        });
    }

    // ── 2. Year validation ─────────────────────────────────────────────────
    if (year) {
        const yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < ALOC_MIN_YEAR || yearNum > ALOC_MAX_YEAR) {
            return res.status(400).json({
                error: 'Invalid year',
                message: `ALOC only has questions for years ${ALOC_MIN_YEAR}–${ALOC_MAX_YEAR}. ` +
                    `Year "${year}" is not available. ` +
                    `NOTE: 2025 does NOT exist in the ALOC database.`,
                validRange: `${ALOC_MIN_YEAR}–${ALOC_MAX_YEAR}`,
            });
        }
    }

    // ── 3. Type validation ─────────────────────────────────────────────────
    const validTypes = ['utme', 'wassce', 'post-utme'];
    let resolvedType = type;

    if (type) {
        const typeLower = type.toLowerCase();
        // Allow friendly aliases
        if (typeLower === 'jamb') resolvedType = 'utme';
        else if (typeLower === 'waec') resolvedType = 'wassce';
        else if (!validTypes.includes(typeLower)) {
            return res.status(400).json({
                error: 'Invalid exam type',
                message: `"${type}" is not a valid type. Use one of: utme, wassce, post-utme`,
                hint: 'For JAMB, use type=utme. ALOC does not have a "JAMB 2025" type.',
            });
        } else {
            resolvedType = typeLower;
        }
    }

    // ── 4. Amount clamp ────────────────────────────────────────────────────
    const clampedAmount = Math.min(Math.max(parseInt(amount, 10) || 10, 1), 40);

    // ── 5. Build URL ───────────────────────────────────────────────────────
    // Endpoint: GET /api/v2/m/{amount}?subject=...&type=...&year=...
    const params = new URLSearchParams({ subject: subjectSlug });
    if (resolvedType) params.append('type', resolvedType);
    if (year) params.append('year', year);

    const url = `${ALOC_BASE}/m/${clampedAmount}?${params.toString()}`;

    console.log(`[ALOC Proxy] Requesting: ${url}`);
    console.log(`[ALOC Proxy] Original params: subject="${subject}" → slug="${subjectSlug}", type="${type}" → "${resolvedType}", year="${year}"`);

    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'AccessToken': token,
            },
            timeout: 10000,
        });

        // ── 6. Defensive JSON parsing ──────────────────────────────────────
        const parsed = safeParseAlocResponse(response);

        if (!parsed.ok) {
            console.error(`[ALOC Proxy] Non-JSON response from ALOC:`, parsed.rawSnippet);
            return res.status(502).json({
                error: 'ALOC returned an invalid response',
                message: parsed.error,
                debug: {
                    url,
                    subjectSlug,
                    resolvedType,
                    year,
                    snippet: parsed.rawSnippet,
                },
            });
        }

        const data = parsed.data;

        // ── 7. Check ALOC's own status field ──────────────────────────────
        if (data.status === false || data.status === 0) {
            console.warn(`[ALOC Proxy] ALOC status=false. Message: ${data.message}`);
            return res.status(404).json({
                error: 'No questions found',
                message: data.message || 'ALOC returned no questions for this filter combination.',
                hint: 'Try a different year (2001–2020), or remove the year/type filter.',
                appliedFilters: { subject: subjectSlug, type: resolvedType, year, amount: clampedAmount },
            });
        }

        console.log(`[ALOC Proxy] Success — returned ${data.data?.length ?? '?'} question(s)`);
        return res.status(200).json(data);

    } catch (error) {
        const statusCode = error.response?.status;
        const rawBody = error.response?.data;

        console.error(`[ALOC Proxy] HTTP ${statusCode || 'network'} error:`, error.message);

        // ── Detect HTML error page in the axios error response ─────────────
        if (typeof rawBody === 'string' && rawBody.trim().startsWith('<!DOCTYPE')) {
            console.error(`[ALOC Proxy] Got HTML page! Snippet: ${rawBody.substring(0, 300)}`);
            return res.status(statusCode || 502).json({
                error: 'ALOC returned an HTML error page',
                message: `The ALOC API returned HTML (HTTP ${statusCode}) instead of JSON. ` +
                    `This means the endpoint is wrong, the token is invalid, ` +
                    `or the requested year/subject has no data.`,
                debug: {
                    url,
                    subjectSlug,
                    resolvedType,
                    year: year || 'not set',
                    httpStatus: statusCode,
                },
            });
        }

        return res.status(statusCode || 500).json({
            error: 'Failed to fetch questions from ALOC',
            message: error.message,
            details: rawBody || null,
            debug: {
                url,
                subjectSlug,
                resolvedType,
                year: year || 'not set',
            },
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get Available Subjects
// GET /api/cbt/subjects
// Returns the list of valid slugs so the frontend can validate before calling
// ─────────────────────────────────────────────────────────────────────────────
export const getAvailableSubjects = (req, res) => {
    const unique = [...new Set(Object.values(SUBJECT_SLUG_MAP))];
    return res.status(200).json({
        subjects: unique,
        yearRange: `${ALOC_MIN_YEAR}–${ALOC_MAX_YEAR}`,
        examTypes: ['utme', 'wassce', 'post-utme'],
        note: 'Year 2025 does NOT exist in the ALOC database. Valid years: 2001–2020.',
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Save CBT Result
// POST /api/cbt/results
// ─────────────────────────────────────────────────────────────────────────────
export const saveCBTResult = async (req, res) => {
    try {
        const studentId = req.user._id;
        const resultData = { ...req.body, studentId };

        const newResult = new CBTResult(resultData);
        await newResult.save();

        res.status(201).json({
            status: 'success',
            data: newResult
        });
    } catch (error) {
        console.error('[CBT Save Result] Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to save CBT result'
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get CBT Results Summary
// GET /api/cbt/results/summary?studentId=...
// ─────────────────────────────────────────────────────────────────────────────
export const getCBTResultsSummary = async (req, res) => {
    try {
        const studentId = req.query.studentId || req.user._id;

        const results = await CBTResult.find({ studentId }).sort({ takenAt: -1 }).limit(50);

        if (results.length === 0) {
            return res.status(200).json({
                overallAccuracy: 0,
                examsTaken: 0,
                bestSubject: 'N/A',
                weakestSubject: 'N/A',
                recentResults: []
            });
        }

        const totalAccuracy = results.reduce((acc, curr) => acc + curr.accuracy, 0);
        const overallAccuracy = Math.round(totalAccuracy / results.length);

        // Calculate subject performance
        const subjectStats = {};
        results.forEach(res => {
            if (!subjectStats[res.subject]) {
                subjectStats[res.subject] = { total: 0, count: 0 };
            }
            subjectStats[res.subject].total += res.accuracy;
            subjectStats[res.subject].count += 1;
        });

        let bestSubject = 'N/A';
        let bestAcc = -1;
        let weakestSubject = 'N/A';
        let weakestAcc = 101;

        Object.keys(subjectStats).forEach(subject => {
            const avg = subjectStats[subject].total / subjectStats[subject].count;
            if (avg > bestAcc) {
                bestAcc = avg;
                bestSubject = subject;
            }
            if (avg < weakestAcc) {
                weakestAcc = avg;
                weakestSubject = subject;
            }
        });

        res.status(200).json({
            overallAccuracy,
            examsTaken: results.length,
            bestSubject,
            weakestSubject,
            recentResults: results.slice(0, 5)
        });
    } catch (error) {
        console.error('[CBT Results Summary] Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch CBT results summary'
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Get All CBT Results
// GET /api/cbt/results
// ─────────────────────────────────────────────────────────────────────────────
export const getCBTResults = async (req, res) => {
    try {
        const studentId = req.user._id;
        const results = await CBTResult.find({ studentId }).sort({ takenAt: -1 });
        res.status(200).json({
            status: 'success',
            data: results
        });
    } catch (error) {
        console.error('[CBT All Results] Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch CBT results'
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER: Generate Explanation
// POST /api/cbt/explain
// ─────────────────────────────────────────────────────────────────────────────
export const explainQuestion = async (req, res) => {
    const { question, correctAnswer, options } = req.body;

    if (!question || !correctAnswer || !options) {
        return res.status(400).json({ status: 'error', message: 'Missing fields' });
    }

    try {
        const qHash = crypto.createHash('sha256')
            .update(`${question}|${correctAnswer}|${options.sort().join(',')}`)
            .digest('hex');

        // Check cache
        const cached = await ExplanationCache.findOne({ questionHash: qHash });
        if (cached) {
            return res.status(200).json({ status: 'success', explanation: cached.explanation });
        }

        // Generate AI explanation
        const selectedModel = MODEL_REGISTRY.find(m => m.recommended) || MODEL_REGISTRY[0];

        const prompt = `
            Question: ${question}
            Options: ${options.join(', ')}
            Correct Answer: ${correctAnswer}

            Give a short, clear explanation (2-3 sentences max) of why
            "${correctAnswer}" is correct. Write for a secondary school student.
        `;

        const response = await aiClient.chatCompletion({
            model: selectedModel.id,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
            temperature: 0.5,
        });

        const explanation = response.choices[0].message.content.trim();

        // Save to cache
        await ExplanationCache.create({
            questionHash: qHash,
            questionText: question,
            correctAnswer,
            explanation
        });

        res.status(200).json({ status: 'success', explanation });
    } catch (error) {
        console.error('[CBT Explanation] Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to generate explanation' });
    }
};
