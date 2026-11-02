import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import StudyPath from '../models/StudyPath.js';
import { parseDocumentBuffer } from '../utils/documentParser.js';
import {
  studyPathSystemPrompt,
  studyPathResponseSchema,
  studyPathPrompt
} from '../utils/prompts.js';
import { getEnv } from '../config/env.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { awardXP } from './progressController.js';

const BANNED_FILLER_REGEX = /(fundamental principles|core terminology|key ideas build|introduction to (the )?primary concepts|^definition$)/i;

// ─── chunk config ──────────────────────────────────────────────────────────────
const CHUNK_THRESHOLD   = 40;   // pages — above this we chunk
const CHUNK_SIZE        = 28;   // target pages per chunk
const CHUNK_CONCURRENCY = 3;    // parallel Gemini calls for chunks

/**
 * Validates generated study path nodes against quality criteria.
 * No longer enforces a fixed node count — just needs at least 1.
 */
export function validateStudyPathNodes(nodes, extractedText = '') {
  const problems = [];
  if (!Array.isArray(nodes) || nodes.length < 1) {
    problems.push(`Expected at least 1 node, but received ${Array.isArray(nodes) ? nodes.length : 0}`);
    return problems;   // nothing more to check
  }

  const normExtracted = (extractedText || '').toLowerCase();

  nodes.forEach((node, index) => {
    const nodeNum = node.id ?? (index + 1);

    // 1. Banned filler
    const textsToCheck = [
      node.title || '',
      node.summary || '',
      ...(Array.isArray(node.keyConcepts) ? node.keyConcepts : []),
      ...(Array.isArray(node.sourceFacts)  ? node.sourceFacts  : [])
    ];
    for (const txt of textsToCheck) {
      if (BANNED_FILLER_REGEX.test(String(txt).trim())) {
        problems.push(`Node ${nodeNum} contains banned filler text: "${String(txt).trim()}"`);
        break;
      }
    }

    // 2. Fewer than 4 keyConcepts
    if (!Array.isArray(node.keyConcepts) || node.keyConcepts.length < 4) {
      problems.push(`Node ${nodeNum} has fewer than 4 keyConcepts (found ${node.keyConcepts?.length || 0})`);
    }

    // 3. sourceFacts grounding check (skip when extracted text is unavailable)
    if (normExtracted.length > 0) {
      const facts = Array.isArray(node.sourceFacts) ? node.sourceFacts : [];
      if (facts.length === 0) {
        problems.push(`Node ${nodeNum} has 0 sourceFacts`);
      } else {
        let matchCount = 0;
        for (const fact of facts) {
          const prefix = String(fact).trim().slice(0, 25).toLowerCase();
          if (prefix && normExtracted.includes(prefix)) matchCount++;
        }
        if (matchCount / facts.length < 0.5) {
          problems.push(`Node ${nodeNum} has under half of sourceFacts matching extracted document text (${matchCount}/${facts.length} matched)`);
        }
      }
    }
  });

  return problems;
}

/** kebab-case helper */
function toKebabCase(str) {
  return (str || 'study-path')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'study-path';
}

// ─── coverage helpers ──────────────────────────────────────────────────────────

/**
 * Returns the set of uncovered pages (1-based) given total page count,
 * all nodes' sourcePages and skippedPages.
 */
function uncoveredPages(totalPages, nodes, skippedPages = []) {
  const covered = new Set(skippedPages.map(Number));
  for (const node of nodes) {
    for (const p of (node.sourcePages || [])) covered.add(Number(p));
  }
  const missing = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!covered.has(p)) missing.push(p);
  }
  return missing;
}

function coveragePct(totalPages, missing) {
  if (totalPages === 0) return 100;
  return Math.round(((totalPages - missing.length) / totalPages) * 100);
}

// ─── pdf-lib chunk helper ──────────────────────────────────────────────────────

/**
 * Slices a PDF buffer into page ranges using pdf-lib.
 * Returns array of { buffer, startPage, endPage } (1-based, inclusive).
 */
async function slicePdfIntoChunks(pdfBuffer, totalPages, chunkSize) {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const chunks = [];
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalPages);
    const chunkDoc = await PDFDocument.create();
    // copyPages uses 0-based indices
    const indices = [];
    for (let i = start - 1; i <= end - 1; i++) indices.push(i);
    const copiedPages = await chunkDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) chunkDoc.addPage(page);
    const chunkBytes = await chunkDoc.save();
    chunks.push({
      buffer: Buffer.from(chunkBytes),
      startPage: start,
      endPage: end
    });
  }
  return chunks;
}

// ─── Gemini call ───────────────────────────────────────────────────────────────

/**
 * Calls Gemini 2.5 Flash with a PDF buffer (or raw text) and returns parsed JSON.
 * pageOffset: when chunking, the chunk's 1-based start page so the model knows
 *             original page numbers.
 */
async function callGeminiForStudyPath({
  apiKey,
  file,
  rawText,
  title,
  retryProblems = [],
  pageOffset = 1,        // first real page of this chunk in the original document
  totalPages = 0         // full document page count (0 = unknown)
}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: studyPathSystemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: studyPathResponseSchema,
      temperature: 0.2
    }
  });

  const contents = [];
  let tempFilePath = null;
  let uploadedGoogleFile = null;
  let fileManager = null;

  try {
    const isPdf = file && (
      file.mimetype?.includes('pdf') ||
      file.originalname?.toLowerCase().endsWith('.pdf') ||
      (Buffer.isBuffer(file.buffer) && file.buffer.slice(0, 4).toString() === '%PDF')
    );

    if (isPdf && file.buffer) {
      const FIFTEEN_MB = 15 * 1024 * 1024;
      if (file.buffer.length > FIFTEEN_MB) {
        fileManager = new GoogleAIFileManager(apiKey);
        tempFilePath = path.join(os.tmpdir(), `gemini-${Date.now()}-${file.originalname || 'document.pdf'}`);
        await fs.promises.writeFile(tempFilePath, file.buffer);

        uploadedGoogleFile = await fileManager.uploadFile(tempFilePath, {
          mimeType: 'application/pdf',
          displayName: file.originalname || 'Lecture Deck'
        });

        contents.push({
          fileData: {
            fileUri: uploadedGoogleFile.file.uri,
            mimeType: uploadedGoogleFile.file.mimeType
          }
        });
      } else {
        contents.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: file.buffer.toString('base64')
          }
        });
      }
    } else if (rawText) {
      contents.push({ text: `Document Content:\n\n${rawText}` });
    }

    let userInstruction = `Document Title: ${title || 'Study Material'}\n`;
    if (pageOffset > 1 || totalPages > 0) {
      userInstruction += `NOTE: This is a chunk of a larger document. ` +
        `Pages in this chunk correspond to pages ${pageOffset}–${pageOffset + (file?.numpages || 0) - 1} ` +
        `of the full ${totalPages}-page document. ` +
        `Use the ORIGINAL page numbers (starting from ${pageOffset}) in sourcePages — not local chunk page numbers.\n`;
    }
    userInstruction += `Generate a sequential study path strictly following all system instructions.`;

    if (retryProblems && retryProblems.length > 0) {
      userInstruction += `\n\nFix these issues:\n${retryProblems.map(p => `- ${p}`).join('\n')}`;
    }

    contents.push({ text: userInstruction });

    const attempt = retryProblems.length > 0 ? 'retry' : 'initial attempt';
    console.log(`[generateStudyPath] Invoking Gemini 2.5 Flash (${attempt})...`);
    const result = await model.generateContent(contents);
    const responseText = result.response.text();

    let cleaned = (responseText || '').trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    return JSON.parse(cleaned);
  } finally {
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
    if (fileManager && uploadedGoogleFile?.file?.name) {
      fileManager.deleteFile(uploadedGoogleFile.file.name).catch(() => {});
    }
  }
}

// ─── coverage-aware single-pass generation ────────────────────────────────────

/**
 * Calls Gemini once, then retries if there are uncovered pages.
 * Returns { parsedData, validationProblems }.
 */
async function generateAndVerify({ apiKey, file, rawText, title, totalPages, pageOffset = 1 }) {
  // Initial call
  let parsedData = await callGeminiForStudyPath({ apiKey, file, rawText, title, pageOffset, totalPages });

  // Quality validation
  let validationProblems = validateStudyPathNodes(parsedData?.nodes, rawText);

  // Coverage check
  const skipped = parsedData?.skippedPages || [];
  let missing = totalPages > 0
    ? uncoveredPages(totalPages, parsedData?.nodes || [], skipped)
    : [];

  const coverageRetryNeeded = missing.length > 0;

  // Build retry problems list
  const allProblems = [...validationProblems];
  if (coverageRetryNeeded) {
    allProblems.push(
      `These pages are not covered by any node: ${missing.join(', ')}. ` +
      `Add nodes for them, or list them in skippedPages if they have no study content. ` +
      `Return the full updated path.`
    );
  }

  if (allProblems.length > 0) {
    console.warn('[generateStudyPath] Problems on initial attempt:', allProblems);

    const retryData = await callGeminiForStudyPath({
      apiKey, file, rawText, title, pageOffset, totalPages,
      retryProblems: allProblems
    });

    const retryValidation = validateStudyPathNodes(retryData?.nodes, rawText);
    const retrySkipped = retryData?.skippedPages || [];
    const retryMissing = totalPages > 0
      ? uncoveredPages(totalPages, retryData?.nodes || [], retrySkipped)
      : [];

    if (retryMissing.length > 0) {
      console.warn(`[generateStudyPath] After retry, still ${retryMissing.length} uncovered page(s): [${retryMissing.join(', ')}] — proceeding anyway.`);
    }

    return { parsedData: retryData, validationProblems: retryValidation, uncovered: retryMissing };
  }

  return { parsedData, validationProblems, uncovered: missing };
}

// ─── chunked generation for large PDFs ────────────────────────────────────────

/**
 * Splits PDF into chunks, calls Gemini in parallel (limited concurrency),
 * merges and renumbers nodes with correct original-document page numbers.
 */
async function generateChunked({ apiKey, originalFile, rawText, title, totalPages }) {
  console.log(`[generateStudyPath] Large PDF (${totalPages} pages) — chunking into ~${CHUNK_SIZE}-page segments.`);
  const chunks = await slicePdfIntoChunks(originalFile.buffer, totalPages, CHUNK_SIZE);
  console.log(`[generateStudyPath] ${chunks.length} chunk(s) created.`);

  // Process chunks with limited concurrency
  const chunkResults = [];
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (chunk) => {
      const chunkFile = {
        buffer: chunk.buffer,
        mimetype: 'application/pdf',
        originalname: originalFile.originalname || 'document.pdf',
        numpages: chunk.endPage - chunk.startPage + 1
      };
      console.log(`[generateStudyPath] Chunk pages ${chunk.startPage}–${chunk.endPage}...`);
      const { parsedData } = await generateAndVerify({
        apiKey,
        file: chunkFile,
        rawText: '',   // don't pass full text for chunked; rely on PDF content
        title,
        totalPages: chunk.endPage - chunk.startPage + 1,
        pageOffset: chunk.startPage
      });
      return { parsedData, chunk };
    }));
    chunkResults.push(...batchResults);
  }

  // Merge chunks: take title/courseCode from first chunk
  const firstData = chunkResults[0]?.parsedData;
  const mergedNodes = [];
  const mergedSkipped = [];
  let nodeIdCounter = 1;

  for (const { parsedData } of chunkResults) {
    if (!parsedData) continue;
    for (const node of (parsedData.nodes || [])) {
      mergedNodes.push({ ...node, id: nodeIdCounter++ });
    }
    for (const p of (parsedData.skippedPages || [])) {
      if (!mergedSkipped.includes(p)) mergedSkipped.push(p);
    }
  }

  return {
    title: firstData?.title || title,
    courseCode: firstData?.courseCode,
    nodes: mergedNodes,
    skippedPages: mergedSkipped
  };
}

// ─── server-side post-processing ──────────────────────────────────────────────

function postProcessNodes(rawNodes, documentId) {
  return (rawNodes || []).map((node, index) => {
    const sourceFacts = Array.isArray(node.sourceFacts) ? node.sourceFacts : [];
    const sourcePages = Array.isArray(node.sourcePages) && node.sourcePages.length > 0
      ? node.sourcePages
      : [index + 1];

    const xp = 20 + Math.min(15, sourceFacts.length);

    const summaryText = node.summary || '';
    const keyConceptsText = Array.isArray(node.keyConcepts) ? node.keyConcepts.join(' ') : '';
    const totalChars = summaryText.length + keyConceptsText.length;
    const clampedMinutes = Math.min(9, Math.max(5, Math.round(5 + totalChars / 250)));
    const duration = `${clampedMinutes} min`;

    const firstPage = sourcePages[0] || 1;
    const slideImage = `/api/slides/${documentId}/page-${firstPage}.png`;

    const status = index === 0 ? 'active' : 'locked';

    // Shuffle quiz options
    const rawQuiz = node.quiz || {};
    let options = Array.isArray(rawQuiz.options) ? [...rawQuiz.options] : [];
    let correctIdx = typeof rawQuiz.correctAnswerIndex === 'number' ? rawQuiz.correctAnswerIndex : 0;
    if (options.length > 0) {
      if (correctIdx < 0 || correctIdx >= options.length) correctIdx = 0;
      const targetOption = options[correctIdx];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      const newIdx = options.indexOf(targetOption);
      correctIdx = newIdx >= 0 ? newIdx : 0;
    }

    const quiz = {
      question: rawQuiz.question || '',
      options,
      correctAnswerIndex: correctIdx,
      explanation: rawQuiz.explanation || ''
    };

    const result = {
      id: typeof node.id === 'number' ? node.id : index + 1,
      title: node.title || `Concept ${index + 1}`,
      status,
      xp,
      duration,
      slideImage,
      sourcePages,
      sourceFacts,
      summary: summaryText,
      keyConcepts: Array.isArray(node.keyConcepts) ? node.keyConcepts : [],
      quiz,
      lessonContent: {
        analogy: '',
        paragraphs: summaryText ? [summaryText] : ['Key concepts from this lecture section.'],
        keyConcepts: Array.isArray(node.keyConcepts) ? node.keyConcepts : []
      }
    };

    // Optional unit field
    if (node.unit && typeof node.unit === 'string' && node.unit.trim()) {
      result.unit = node.unit.trim();
    }

    return result;
  });
}

// ─── main handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/generate-path
 * Accepts multipart/form-data with a PDF/document or JSON with text
 */
export const generateStudyPath = async (req, res) => {
  try {
    let rawText = '';
    let fileName = '';
    let totalPages = 0;

    const file = req.file || (req.files && (req.files.pdf?.[0] || req.files.file?.[0] || req.files.document?.[0]));

    if (file) {
      fileName = file.originalname || 'document.pdf';
      console.log(`[generateStudyPath] Processing uploaded file: ${fileName} (${file.size || file.buffer?.length} bytes)`);
      try {
        const parsed = await parseDocumentBuffer(file.buffer, file.originalname, file.mimetype);
        rawText    = parsed?.text || '';
        totalPages = parsed?.numpages || 0;
      } catch (parseErr) {
        console.warn('[generateStudyPath] Document parser text extraction notice:', parseErr.message);
      }
    }

    if (!rawText && req.body?.text && String(req.body.text).trim().length >= 30) {
      rawText = String(req.body.text).trim();
      fileName = fileName || req.body.title || 'Study Material';
    }

    const explicitTitle = req.body?.title?.trim();
    const derivedTitle  = explicitTitle || fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Interactive Study Path';
    const cleanTitle    = derivedTitle.charAt(0).toUpperCase() + derivedTitle.slice(1);

    const apiKey = getEnv('GEMINI_API_KEY') || getEnv('GOOGLE_API_KEY') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('[generateStudyPath] Missing GEMINI_API_KEY or GOOGLE_API_KEY in environment.');
      return res.status(500).json({
        success: false,
        message: 'AI Service Unavailable: Gemini API key is not configured on the server.'
      });
    }

    // ── Generation: chunked for large PDFs, single-pass for small ones ──────────
    let parsedData;
    let validationProblems = [];

    const isPdf = file && (
      file.mimetype?.includes('pdf') ||
      file.originalname?.toLowerCase().endsWith('.pdf') ||
      (Buffer.isBuffer(file.buffer) && file.buffer.slice(0, 4).toString() === '%PDF')
    );

    if (isPdf && totalPages > CHUNK_THRESHOLD) {
      try {
        parsedData = await generateChunked({ apiKey, originalFile: file, rawText, title: cleanTitle, totalPages });
      } catch (err) {
        console.error('[generateStudyPath] Chunked generation failed:', err.message);
        return res.status(502).json({ success: false, message: `Chunked study path generation failed: ${err.message}` });
      }
    } else {
      try {
        const result = await generateAndVerify({ apiKey, file, rawText, title: cleanTitle, totalPages });
        parsedData         = result.parsedData;
        validationProblems = result.validationProblems;

        if (validationProblems.length > 0) {
          console.error('[generateStudyPath] Validation failed after retry:', validationProblems);
          return res.status(502).json({
            success: false,
            message: `Generated study path failed quality validation: ${validationProblems.join('; ')}`,
            issues: validationProblems
          });
        }

        // Log coverage
        const skippedPages = parsedData?.skippedPages || [];
        if (totalPages > 0) {
          const missing = result.uncovered;
          const pct     = coveragePct(totalPages, missing);
          console.log(`[generateStudyPath] Coverage: ${pct}% (${totalPages - missing.length}/${totalPages} pages).`);
          if (missing.length > 0) {
            console.warn(`[generateStudyPath] Uncovered pages after retry: [${missing.join(', ')}]`);
          }
          if (skippedPages.length > 0) {
            console.log(`[generateStudyPath] Skipped (no study content): [${skippedPages.join(', ')}]`);
          }
        }
      } catch (err) {
        console.error('[generateStudyPath] Generation failed:', err.message);
        return res.status(502).json({ success: false, message: `Failed to generate study path with Gemini: ${err.message}` });
      }
    }

    // ── Final coverage log for chunked results ───────────────────────────────
    if (isPdf && totalPages > CHUNK_THRESHOLD && totalPages > 0) {
      const skipped = parsedData?.skippedPages || [];
      const missing = uncoveredPages(totalPages, parsedData?.nodes || [], skipped);
      const pct     = coveragePct(totalPages, missing);
      console.log(`[generateStudyPath] Merged coverage: ${pct}% (${totalPages - missing.length}/${totalPages} pages across ${parsedData?.nodes?.length || 0} nodes).`);
      if (missing.length > 0) {
        console.warn(`[generateStudyPath] Still uncovered after chunking: [${missing.join(', ')}]`);
      }
    }

    const finalTitle  = parsedData.title || cleanTitle;
    const topicId     = toKebabCase(finalTitle);
    const courseCode  = parsedData.courseCode || `${finalTitle.slice(0, 6).toUpperCase()} 101 · Interactive Study Path`;
    const documentId  = req.body?.documentId || req.body?.docId || topicId;

    // Post-process
    const processedNodes = postProcessNodes(parsedData.nodes, documentId);

    // Persistence
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.body?.userId || 'anonymous-user';

    try {
      if (userId && userId !== 'anonymous-user') {
        await StudyPath.updateMany({ userId, isActive: true }, { $set: { isActive: false } });
        await incrementAIUsage(req.user?._id || userId).catch(() => {});
        await awardXP(req.user?._id || userId, 'ai_study_path').catch(() => {});
      }

      await StudyPath.deleteOne({ topicId }).catch(() => {});

      const savedRecord = new StudyPath({
        userId,
        topicId,
        title: finalTitle,
        courseCode,
        currentProgress: 0,
        nodes: processedNodes,
        isActive: true,
        sourceFileName: fileName,
        extractedText: rawText
      });

      await savedRecord.save();
      console.log(`[generateStudyPath] Saved StudyPath: ${topicId} (${processedNodes.length} nodes) for user ${userId}`);
    } catch (dbErr) {
      console.warn('[generateStudyPath] MongoDB save warning (proceeding with response):', dbErr.message);
    }

    // Response formatting
    const isDebug = String(req.query?.debug) === '1';
    const responseNodes = processedNodes.map(node => {
      const nodeCopy = { ...node };
      if (!isDebug) delete nodeCopy.sourceFacts;
      return nodeCopy;
    });

    const structuredStudyPath = {
      topicId,
      title: finalTitle,
      courseCode,
      currentProgress: 0,
      nodes: responseNodes
    };

    return res.status(201).json({
      success: true,
      message: 'Study path generated successfully',
      studyPath: structuredStudyPath,
      path: structuredStudyPath,
      topicId
    });

  } catch (error) {
    console.error('❌ generateStudyPath error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to process document and generate study path'
    });
  }
};

/**
 * GET /api/generate-path/active or /api/study-path/active
 */
export const getActiveStudyPath = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.query?.userId;

    if (!userId || userId === 'anonymous-user') {
      return res.status(200).json({ success: true, studyPath: null, message: 'No authenticated user session' });
    }

    const activeRecord = await StudyPath.findOne({ userId, isActive: true }).sort({ updatedAt: -1 }).lean();

    if (!activeRecord) {
      const recent = await StudyPath.findOne({ userId }).sort({ updatedAt: -1 }).lean();
      if (recent) {
        return res.status(200).json({
          success: true,
          studyPath: {
            topicId: recent.topicId,
            title: recent.title,
            courseCode: recent.courseCode,
            currentProgress: recent.currentProgress || 0,
            nodes: recent.nodes
          }
        });
      }
      return res.status(200).json({ success: true, studyPath: null });
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: activeRecord.topicId,
        title: activeRecord.title,
        courseCode: activeRecord.courseCode,
        currentProgress: activeRecord.currentProgress || 0,
        nodes: activeRecord.nodes
      }
    });

  } catch (error) {
    console.error('[getActiveStudyPath] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/study-path/:topicId
 */
export const getStudyPathById = async (req, res) => {
  try {
    const { topicId } = req.params;
    const pathRecord = await StudyPath.findOne({ topicId }).lean();

    if (!pathRecord) {
      return res.status(404).json({ success: false, message: 'Study path not found' });
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: pathRecord.topicId,
        title: pathRecord.title,
        courseCode: pathRecord.courseCode,
        currentProgress: pathRecord.currentProgress || 0,
        nodes: pathRecord.nodes
      }
    });

  } catch (error) {
    console.error('[getStudyPathById] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/study-path/all or /api/study-path/user/all
 */
export const getUserStudyPaths = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.query?.userId;

    if (!userId || userId === 'anonymous-user') {
      return res.status(200).json({ success: true, studyPaths: [] });
    }

    const paths = await StudyPath.find({ userId }).sort({ updatedAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      studyPaths: paths.map(p => ({
        topicId: p.topicId,
        title: p.title,
        courseCode: p.courseCode,
        currentProgress: p.currentProgress || 0,
        nodes: p.nodes
      }))
    });
  } catch (error) {
    console.error('[getUserStudyPaths] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/study-path/:topicId
 */
export const deleteStudyPath = async (req, res) => {
  try {
    const { topicId } = req.params;
    const userId = req.user?._id?.toString() || req.user?.firebaseUid;

    const query = { topicId };
    if (userId && userId !== 'anonymous-user') query.userId = userId;

    const result = await StudyPath.deleteOne(query);
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Study path not found or not owned by user' });
    }

    return res.status(200).json({ success: true, message: 'Study path deleted' });
  } catch (error) {
    console.error('[deleteStudyPath] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/study-path/:topicId/node/:nodeId
 */
export const updateNodeStatus = async (req, res) => {
  try {
    const { topicId, nodeId } = req.params;
    const { status } = req.body;
    const targetId = parseInt(nodeId, 10);

    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord) {
      return res.status(404).json({ success: false, message: 'Study path not found' });
    }

    const nodeIndex = pathRecord.nodes.findIndex(n => n.id === targetId);
    if (nodeIndex !== -1) {
      pathRecord.nodes[nodeIndex].status = status;

      if (status === 'completed' && nodeIndex + 1 < pathRecord.nodes.length) {
        if (pathRecord.nodes[nodeIndex + 1].status === 'locked') {
          pathRecord.nodes[nodeIndex + 1].status = 'active';
        }
      }

      pathRecord.currentProgress = pathRecord.nodes.filter(n => n.status === 'completed').length;
      await pathRecord.save();
    }

    return res.status(200).json({
      success: true,
      studyPath: {
        topicId: pathRecord.topicId,
        title: pathRecord.title,
        courseCode: pathRecord.courseCode,
        currentProgress: pathRecord.currentProgress,
        nodes: pathRecord.nodes
      }
    });

  } catch (error) {
    console.error('[updateNodeStatus] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};
