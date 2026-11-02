import StudyPath from '../models/StudyPath.js';
import { parseDocumentBuffer } from '../utils/documentParser.js';
import { studyPathSystemPrompt } from '../utils/prompts.js';
import { getEnv } from '../config/env.js';
import aiClient from '../utils/aiClient.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { awardXP } from './progressController.js';

const BANNED_FILLER_REGEX = /(fundamental principles|core terminology|key ideas build|introduction to (the )?primary concepts|^definition$)/i;

/**
 * Validates generated study path nodes against quality criteria.
 * Enforces at least 1 node, minimum 4 keyConcepts, no banned filler, grounded sourceFacts.
 */
export function validateStudyPathNodes(nodes, extractedText = '') {
  const problems = [];
  if (!Array.isArray(nodes) || nodes.length < 1) {
    problems.push(`Expected at least 1 node, but received ${Array.isArray(nodes) ? nodes.length : 0}`);
    return problems;
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

// ─── DeepSeek call ────────────────────────────────────────────────────────────

/**
 * Calls DeepSeek with extracted document text and returns parsed JSON.
 */
async function callDeepSeekForStudyPath({
  rawText,
  title,
  retryProblems = [],
  totalPages = 0
}) {
  let userInstruction = `Document Title: ${title || 'Study Material'}\n`;
  if (totalPages > 0) {
    userInstruction += `Total Pages: ${totalPages}. Include sourcePages (1-based) accurately covering the content based on page markers.\n`;
  }
  userInstruction += `Generate a sequential study path strictly following all system instructions and return as JSON.\n\n`;

  if (retryProblems && retryProblems.length > 0) {
    userInstruction += `Fix these validation issues from previous attempt:\n${retryProblems.map(p => `- ${p}`).join('\n')}\n\n`;
  }

  // DeepSeek-V3 context window is 64k tokens (~180,000 characters)
  const safeText = typeof rawText === 'string' ? rawText : String(rawText || '');
  const trimmedText = safeText.length > 180000
    ? safeText.slice(0, 180000) + '\n\n[Content truncated due to size limit]'
    : safeText;

  userInstruction += `Document Content:\n${trimmedText}`;

  console.log(`[generateStudyPath] Invoking DeepSeek for "${title}" (${trimmedText.length} chars)...`);

  const response = await aiClient.chatCompletion({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: studyPathSystemPrompt },
      { role: 'user', content: userInstruction }
    ],
    max_tokens: 4000,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  return JSON.parse(cleaned);
}

// ─── coverage-aware generation with retry ─────────────────────────────────────

async function generateAndVerify({ rawText, title, totalPages }) {
  let parsedData = await callDeepSeekForStudyPath({ rawText, title, totalPages });
  let validationProblems = validateStudyPathNodes(parsedData?.nodes, rawText);

  const skipped = parsedData?.skippedPages || [];
  let missing = totalPages > 0
    ? uncoveredPages(totalPages, parsedData?.nodes || [], skipped)
    : [];

  const allProblems = [...validationProblems];
  if (missing.length > 0) {
    allProblems.push(
      `These pages are not covered by any node: ${missing.join(', ')}. Add nodes for them or list them in skippedPages if they have no study content.`
    );
  }

  if (allProblems.length > 0) {
    console.warn('[generateStudyPath] Validation issues on initial attempt:', allProblems);
    try {
      const retryData = await callDeepSeekForStudyPath({
        rawText,
        title,
        totalPages,
        retryProblems: allProblems
      });
      const retryValidation = validateStudyPathNodes(retryData?.nodes, rawText);
      const retrySkipped = retryData?.skippedPages || [];
      const retryMissing = totalPages > 0
        ? uncoveredPages(totalPages, retryData?.nodes || [], retrySkipped)
        : [];

      return { parsedData: retryData, validationProblems: retryValidation, uncovered: retryMissing };
    } catch (retryErr) {
      console.warn('[generateStudyPath] Retry failed, falling back to initial data:', retryErr.message);
    }
  }

  return { parsedData, validationProblems, uncovered: missing };
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

    // 1. Prioritize client pre-extracted text if provided
    if (req.body?.text && String(req.body.text).trim().length >= 30) {
      rawText = String(req.body.text).trim();
      fileName = file?.originalname || req.body?.title || 'Study Material';
      console.log(`[generateStudyPath] Using client pre-extracted text for: ${fileName} (${rawText.length} chars)`);
    } else if (file && file.buffer) {
      fileName = file.originalname || 'document.pdf';
      console.log(`[generateStudyPath] Processing uploaded file: ${fileName} (${file.size || file.buffer?.length} bytes)`);
      try {
        const parsed = await parseDocumentBuffer(file.buffer, file.originalname, file.mimetype);
        if (typeof parsed === 'string') {
          rawText = parsed;
        } else if (parsed && typeof parsed.text === 'string') {
          rawText = parsed.text;
          totalPages = parsed.numpages || 0;
        } else if (parsed?.text) {
          rawText = String(parsed.text);
          totalPages = parsed.numpages || 0;
        }
      } catch (parseErr) {
        console.warn('[generateStudyPath] Document parser text extraction notice:', parseErr.message);
      }
    }

    // Ensure rawText is always safely coerced to a trimmed string
    rawText = typeof rawText === 'string' ? rawText.trim() : String(rawText || '').trim();

    if (!rawText || rawText.length < 30) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract readable text from document. Please upload a clear document or paste text.'
      });
    }

    const explicitTitle = req.body?.title?.trim();
    const derivedTitle  = explicitTitle || fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Interactive Study Path';
    const cleanTitle    = derivedTitle.charAt(0).toUpperCase() + derivedTitle.slice(1);

    const apiKey = getEnv('DEEPSEEK_API_KEY') || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('[generateStudyPath] Missing DEEPSEEK_API_KEY in environment.');
      return res.status(500).json({
        success: false,
        message: 'AI Service Unavailable: DeepSeek API key is not configured on the server.'
      });
    }

    let parsedData;
    let validationProblems = [];
    let uncovered = [];

    try {
      const result = await generateAndVerify({ rawText, title: cleanTitle, totalPages });
      parsedData         = result.parsedData;
      validationProblems = result.validationProblems || [];
      uncovered          = result.uncovered || [];

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
        const pct = coveragePct(totalPages, uncovered);
        console.log(`[generateStudyPath] Coverage: ${pct}% (${totalPages - uncovered.length}/${totalPages} pages).`);
        if (uncovered.length > 0) {
          console.warn(`[generateStudyPath] Uncovered pages: [${uncovered.join(', ')}]`);
        }
        if (skippedPages.length > 0) {
          console.log(`[generateStudyPath] Skipped (no study content): [${skippedPages.join(', ')}]`);
        }
      }
    } catch (err) {
      console.error('[generateStudyPath] Generation failed:', err.message);
      return res.status(502).json({ success: false, message: `Failed to generate study path with DeepSeek: ${err.message}` });
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
