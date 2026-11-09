import fs from 'fs';
import path from 'path';
import StudyPath from '../models/StudyPath.js';
import { generateNodeContent } from './studyPathPdfPipeline.js';
import { validateStudyPathNodes, autoRepairStudyPathNodes, generateChallenge } from '../controllers/studyPathController.js';
import { getBlueprint } from './blueprintEngine.js';
import { getCollectivePatterns } from './collectiveIntelligenceService.js';

// In-memory buffer cache for fast access during generation sessions
const pdfBufferCache = new Map();

// Active generation promises to prevent duplicate in-flight calls within the same process
const activeGenerations = new Map();

const STUDY_PATH_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'study-paths');

// Ensure directory exists
if (!fs.existsSync(STUDY_PATH_UPLOAD_DIR)) {
  try {
    fs.mkdirSync(STUDY_PATH_UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.warn('[studyPathNodeService] Failed to create uploads/study-paths directory:', err.message);
  }
}

/** Store buffer in memory cache and optionally persist to disk */
export async function cachePdfBuffer(topicId, buffer) {
  if (!buffer || !topicId) return;
  pdfBufferCache.set(topicId, buffer);
  try {
    const filePath = path.join(STUDY_PATH_UPLOAD_DIR, `${topicId}.pdf`);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  } catch (err) {
    console.warn(`[studyPathNodeService] Could not persist PDF to disk for ${topicId}:`, err.message);
    return null;
  }
}

/** Retrieve buffer from memory cache, or read from disk */
export async function getPdfBuffer(topicId, storagePath) {
  if (pdfBufferCache.has(topicId)) {
    return pdfBufferCache.get(topicId);
  }
  const candidatePath = storagePath || path.join(STUDY_PATH_UPLOAD_DIR, `${topicId}.pdf`);
  try {
    if (fs.existsSync(candidatePath)) {
      const buffer = await fs.promises.readFile(candidatePath);
      pdfBufferCache.set(topicId, buffer);
      return buffer;
    }
  } catch (err) {
    console.warn(`[studyPathNodeService] Failed to read PDF from disk for ${topicId}:`, err.message);
  }
  return null;
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function durationFromLessonText(summary, keyConcepts, breakdown) {
  const text = [
    summary || '',
    ...(Array.isArray(keyConcepts) ? keyConcepts : []),
    ...(Array.isArray(breakdown) ? breakdown.flatMap((slide) => [slide?.heading || '', slide?.body || '', slide?.memoryTip || '']) : [])
  ].join(' ');
  const readingWords = wordCount(text);
  return `${Math.min(9, Math.max(5, Math.ceil(readingWords / 200)))} min`;
}

function formatQuizItem(rawQuiz = {}) {
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
  return {
    question: rawQuiz.question || '',
    options,
    correctAnswerIndex: correctIdx,
    explanation: rawQuiz.explanation || ''
  };
}

/**
 * Format a single generated node for persistence.
 */
function postProcessSingleNode(node, index, documentId) {
  const sourceFacts = Array.isArray(node.sourceFacts) ? node.sourceFacts : [];
  const sourcePages = Array.isArray(node.sourcePages) && node.sourcePages.length > 0 ? node.sourcePages : [index + 1];
  const xp = 20 + Math.min(15, sourceFacts.length);
  const summaryText = node.summary || '';
  const keyConcepts = Array.isArray(node.keyConcepts) ? node.keyConcepts : [];
  const breakdown = Array.isArray(node.breakdown) ? node.breakdown.map((slide) => ({
    heading: String(slide?.heading || ''),
    body: String(slide?.body || ''),
    ...(slide?.memoryTip ? { memoryTip: String(slide.memoryTip) } : {})
  })) : [];
  const duration = durationFromLessonText(summaryText, keyConcepts, breakdown);
  const firstPage = sourcePages[0] || 1;
  const slideImage = `/api/slides/${documentId}/page-${firstPage}.png`;

  return {
    ...node,
    id: typeof node.id === 'number' ? node.id : index + 1,
    title: node.title || `Concept ${index + 1}`,
    unit: node.unit || '',
    contentStatus: 'ready',
    generationError: null,
    xp,
    duration,
    slideImage,
    sourcePages,
    sourceFacts,
    summary: summaryText,
    breakdown,
    keyConcepts,
    quiz: formatQuizItem(node.quiz),
    quiz2: formatQuizItem(node.quiz2),
    lessonContent: {
      analogy: '',
      paragraphs: summaryText ? [summaryText] : [],
      keyConcepts
    }
  };
}

/**
 * Check if all nodes are ready and generate the Unit Challenge if needed.
 */
async function checkAndTriggerChallenge(topicId) {
  try {
    const pathRecord = await StudyPath.findOne({ topicId });
    if (!pathRecord || !Array.isArray(pathRecord.nodes) || pathRecord.nodes.length === 0) return;

    const allReady = pathRecord.nodes.every((n) => n.contentStatus === 'ready');
    if (!allReady) return;

    if (Array.isArray(pathRecord.challenge?.questions) && pathRecord.challenge.questions.length >= 10) {
      return;
    }

    console.log(`[studyPathNodeService] All ${pathRecord.nodes.length} nodes ready for "${topicId}". Generating Unit Challenge...`);
    const questions = await generateChallenge(pathRecord.toObject());
    if (Array.isArray(questions) && questions.length > 0) {
      await StudyPath.updateOne(
        { topicId },
        {
          $set: {
            'challenge.questions': questions,
            'challenge.generatedAt': new Date(),
            'challenge.stale': false
          }
        }
      );
      console.log(`[studyPathNodeService] Unit Challenge ready with ${questions.length} questions for "${topicId}".`);
    }
  } catch (err) {
    console.warn(`[studyPathNodeService] Failed to auto-generate challenge for "${topicId}":`, err.message);
  }
}

/**
 * Core generation for a single node.
 * Uses atomic findOneAndUpdate to transition from 'pending'|'failed' -> 'generating'.
 */
export async function generateSingleNode(topicId, nodeId) {
  const lockKey = `${topicId}:${nodeId}`;
  if (activeGenerations.has(lockKey)) {
    return activeGenerations.get(lockKey);
  }

  const generationPromise = (async () => {
    // 1. Fetch current node status
    const existing = await StudyPath.findOne({ topicId, 'nodes.id': nodeId }, { 'nodes.$': 1, inventory: 1, totalPages: 1, pdfStoragePath: 1, classification: 1, blueprintId: 1, title: 1 });
    const targetNode = existing?.nodes?.[0];
    if (!targetNode) {
      throw new Error(`Node ${nodeId} not found in topic ${topicId}`);
    }

    if (targetNode.contentStatus === 'ready') {
      return targetNode;
    }

    // 2. Atomic lock: Only transition if pending, failed, or timed out (> 90 seconds generating)
    const ninetySecondsAgo = new Date(Date.now() - 90000);
    const lockAcquired = await StudyPath.findOneAndUpdate(
      {
        topicId,
        'nodes.id': nodeId,
        $or: [
          { 'nodes.contentStatus': { $in: ['pending', 'failed'] } },
          { 'nodes.contentStatus': 'generating', 'nodes.generationStartedAt': { $lt: ninetySecondsAgo } }
        ]
      },
      {
        $set: {
          'nodes.$.contentStatus': 'generating',
          'nodes.$.generationStartedAt': new Date(),
          'nodes.$.generationError': null
        }
      },
      { new: true }
    );

    if (!lockAcquired) {
      // Another worker is already generating this node
      return targetNode;
    }

    console.log(`[studyPathNodeService] Generating content for node ${nodeId} ("${targetNode.title}") in topic "${topicId}"...`);

    try {
      const buffer = await getPdfBuffer(topicId, existing.pdfStoragePath);
      if (!buffer) {
        throw new Error(`PDF material not available to generate node ${nodeId}`);
      }

      const outlineNode = {
        title: targetNode.title,
        unit: targetNode.unit || '',
        sourcePages: targetNode.sourcePages || [nodeId]
      };

      const blueprint = getBlueprint(existing?.classification?.discipline);
      const collectivePatterns = await getCollectivePatterns({
        discipline: existing?.classification?.discipline,
        topicTitle: existing?.title
      });

      const rawGenerated = await generateNodeContent(
        buffer,
        outlineNode,
        existing.inventory || [],
        existing.totalPages || 1,
        validateStudyPathNodes,
        autoRepairStudyPathNodes,
        blueprint,
        collectivePatterns
      );

      const processed = postProcessSingleNode(
        { ...targetNode.toObject(), ...rawGenerated },
        nodeId - 1,
        topicId
      );

      // Save generated content back to DB
      await StudyPath.updateOne(
        { topicId, 'nodes.id': nodeId },
        {
          $set: {
            'nodes.$.summary': processed.summary,
            'nodes.$.breakdown': processed.breakdown,
            'nodes.$.keyConcepts': processed.keyConcepts,
            'nodes.$.quiz': processed.quiz,
            'nodes.$.quiz2': processed.quiz2,
            'nodes.$.sourceFacts': processed.sourceFacts,
            'nodes.$.duration': processed.duration,
            'nodes.$.xp': processed.xp,
            'nodes.$.slideImage': processed.slideImage,
            'nodes.$.lessonContent': processed.lessonContent,
            'nodes.$.contentStatus': 'ready',
            'nodes.$.generationError': null,
            'nodes.$.generationStartedAt': null
          }
        }
      );

      console.log(`[studyPathNodeService] Node ${nodeId} ready for topic "${topicId}".`);

      // Trigger challenge generation if all nodes now ready
      void checkAndTriggerChallenge(topicId);

      return processed;
    } catch (error) {
      console.error(`[studyPathNodeService] Generation failed for node ${nodeId} in "${topicId}":`, error.message);
      await StudyPath.updateOne(
        { topicId, 'nodes.id': nodeId },
        {
          $set: {
            'nodes.$.contentStatus': 'failed',
            'nodes.$.generationError': error.message || 'Generation failed',
            'nodes.$.generationStartedAt': null
          }
        }
      );
      throw error;
    }
  })();

  activeGenerations.set(lockKey, generationPromise);
  try {
    return await generationPromise;
  } finally {
    activeGenerations.delete(lockKey);
  }
}

/**
 * Trigger background generation for multiple nodes with concurrency limit.
 */
export async function triggerNodeGenerations(topicId, nodeIds = [], concurrency = 3) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return;

  const queue = [...nodeIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) break;
      try {
        await generateSingleNode(topicId, nextId);
      } catch (err) {
        console.warn(`[studyPathNodeService] Background worker failed on node ${nextId}:`, err.message);
      }
    }
  });

  void Promise.all(workers);
}

/**
 * Ensures rolling buffer: when student starts node N, make sure N+1, N+2, N+3 are generating or ready.
 */
export async function ensureRollingBuffer(topicId, currentNodeId) {
  try {
    const pathRecord = await StudyPath.findOne({ topicId }, { 'nodes.id': 1, 'nodes.contentStatus': 1 });
    if (!pathRecord || !Array.isArray(pathRecord.nodes)) return;

    const totalNodes = pathRecord.nodes.length;
    const targets = [currentNodeId + 1, currentNodeId + 2, currentNodeId + 3].filter((id) => id <= totalNodes);

    const needed = targets.filter((targetId) => {
      const node = pathRecord.nodes.find((n) => n.id === targetId);
      return node && (node.contentStatus === 'pending' || node.contentStatus === 'failed');
    });

    if (needed.length > 0) {
      console.log(`[studyPathNodeService] Rolling buffer triggering nodes [${needed.join(', ')}] for topic "${topicId}".`);
      void triggerNodeGenerations(topicId, needed, 3);
    }
  } catch (err) {
    console.warn(`[studyPathNodeService] Rolling buffer error:`, err.message);
  }
}

/**
 * Priority preparation for a specific node (e.g. user clicked or opened it).
 * Returns the node once ready or throws. Also triggers the rolling buffer for subsequent nodes.
 */
export async function prepareNode({ topicId, nodeId, bufferNext = true }) {
  const result = await generateSingleNode(topicId, nodeId);
  if (bufferNext) {
    void ensureRollingBuffer(topicId, nodeId);
  }
  return result;
}

/**
 * Get the current content statuses for all nodes in a topic.
 */
export async function getNodeStatuses(topicId) {
  const pathRecord = await StudyPath.findOne(
    { topicId },
    { 'nodes.id': 1, 'nodes.title': 1, 'nodes.unit': 1, 'nodes.status': 1, 'nodes.contentStatus': 1, 'nodes.generationError': 1, challenge: 1 }
  );
  if (!pathRecord) return null;

  const nodes = (pathRecord.nodes || []).map((n) => ({
    id: n.id,
    title: n.title,
    unit: n.unit,
    status: n.status,
    contentStatus: n.contentStatus || 'ready',
    generationError: n.generationError || null
  }));

  const allReady = nodes.every((n) => n.contentStatus === 'ready');
  const hasChallenge = Array.isArray(pathRecord.challenge?.questions) && pathRecord.challenge.questions.length >= 10;

  return {
    topicId,
    nodes,
    allReady,
    challengeReady: hasChallenge,
    challengeStatus: pathRecord.challenge?.status || 'locked'
  };
}

