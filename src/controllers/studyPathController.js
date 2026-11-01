import StudyPath from '../models/StudyPath.js';
import { parseDocumentBuffer } from '../utils/documentParser.js';
import { sampleStudyMaterial } from '../utils/studyMaterialSample.js';
import aiClient from '../utils/aiClient.js';
import { studyPathPrompt } from '../utils/prompts.js';
import { getModelById, MODEL_REGISTRY } from '../config/aiConfig.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { awardXP } from './progressController.js';

/**
 * Creates structured fallback learning nodes from extracted text
 */
function createFallbackNodes(text, title) {
  const cleanTitle = title || 'Core Concepts';
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const chunkSize = Math.max(2, Math.floor(sentences.length / 4));
  const p1 = sentences.slice(0, chunkSize).join(' ') || 'Overview of foundational principles.';
  const p2 = sentences.slice(chunkSize, chunkSize * 2).join(' ') || 'Analysis of core mechanisms and structural rules.';
  const p3 = sentences.slice(chunkSize * 2, chunkSize * 3).join(' ') || 'Practical applications and edge cases.';
  const p4 = sentences.slice(chunkSize * 3).join(' ') || 'Summary of key takeaways and assessment criteria.';

  return [
    {
      id: 1,
      title: 'Foundational Concepts',
      status: 'active',
      xp: 20,
      duration: '5 min',
      summary: `Introduction to the primary concepts of ${cleanTitle}.`,
      keyConcepts: ['Definition', 'Fundamental Principles', 'Core Terminology'],
      lessonContent: {
        analogy: `Think of ${cleanTitle} as a building foundation—everything else rests on these basic principles.`,
        paragraphs: [
          p1.slice(0, 300) || 'Understanding foundational terminology and structure is the essential first step.',
          'Key ideas build sequentially. Master these basics before proceeding.'
        ],
        keyConcepts: ['Definition', 'Fundamental Principles', 'Core Terminology']
      },
      quiz: {
        question: `What is the primary foundation of ${cleanTitle}?`,
        options: [
          'Core foundational principles and correct terminology',
          'Arbitrary rules with no practical application',
          'Unrelated secondary facts',
          'Historical background only'
        ],
        correctAnswerIndex: 0,
        explanation: 'Mastering the core definitions and fundamental mechanisms establishes the basis for advanced problem solving.',
        hint: 'Focus on the main definition and principles.'
      },
      nextNodeTitle: 'Mechanisms & Dynamics'
    },
    {
      id: 2,
      title: 'Mechanisms & Dynamics',
      status: 'locked',
      xp: 25,
      duration: '7 min',
      summary: `Deep dive into how ${cleanTitle} operates under standard conditions.`,
      keyConcepts: ['System Operations', 'Internal State', 'Standard Workflows'],
      lessonContent: {
        analogy: 'Like the moving parts inside a mechanical clock, each component triggers the next.',
        paragraphs: [
          p2.slice(0, 300) || 'Detailed mechanics dictate how data and processes interact in the system.',
          'Understanding cause and effect relationships ensures predictable outcomes.'
        ],
        keyConcepts: ['System Operations', 'Internal State', 'Standard Workflows']
      },
      quiz: {
        question: `How do the core mechanisms operate in ${cleanTitle}?`,
        options: [
          'Through structured, predictable operations and state transitions',
          'Completely randomly without order',
          'Only when manually configured each time',
          'Without state or structure'
        ],
        correctAnswerIndex: 0,
        explanation: 'Structured operations and state transitions maintain system stability and predictable execution.',
        hint: 'Think about systematic processes.'
      },
      nextNodeTitle: 'Applied Problem Solving'
    },
    {
      id: 3,
      title: 'Applied Problem Solving',
      status: 'locked',
      xp: 30,
      duration: '8 min',
      summary: 'Practical application, common pitfalls, and edge-case optimization.',
      keyConcepts: ['Real-world Scenarios', 'Edge Cases', 'Efficiency'],
      lessonContent: {
        analogy: 'Like a driver navigating heavy rain, you must apply the rules to unpredictable real-world situations.',
        paragraphs: [
          p3.slice(0, 300) || 'Applying theoretical knowledge requires recognizing specific patterns in complex scenarios.',
          'Optimization focuses on minimizing overhead and handling edge cases gracefully.'
        ],
        keyConcepts: ['Real-world Scenarios', 'Edge Cases', 'Efficiency']
      },
      quiz: {
        question: 'What is the most effective way to resolve complex edge cases?',
        options: [
          'Apply systematic diagnostic patterns and verify boundary conditions',
          'Ignore edge cases until they cause complete failure',
          'Change the base definitions arbitrarily',
          'Disable error checking entirely'
        ],
        correctAnswerIndex: 0,
        explanation: 'Verifying boundary conditions with systematic diagnostic patterns ensures robust solutions.',
        hint: 'Think about test boundaries and verification.'
      },
      nextNodeTitle: 'Unit Assessment'
    },
    {
      id: 4,
      title: 'Unit Assessment',
      status: 'locked',
      xp: 50,
      duration: '10 min',
      summary: `Comprehensive evaluation of complete mastery over ${cleanTitle}.`,
      keyConcepts: ['Active Recall', 'Synthesized Knowledge', 'Retention'],
      lessonContent: {
        analogy: 'The flight simulator test before flying solo—synthesizes all skills together.',
        paragraphs: [
          p4.slice(0, 300) || 'Synthesize all learned concepts to demonstrate end-to-end subject mastery.',
          'Review your answers thoroughly to solidify long-term retention.'
        ],
        keyConcepts: ['Active Recall', 'Synthesized Knowledge', 'Retention']
      },
      quiz: {
        question: `Which factor best guarantees long-term retention of ${cleanTitle}?`,
        options: [
          'Active recall and practical synthesis across all subtopics',
          'Passive reading without testing knowledge',
          'Cramming right before testing',
          'Memorizing raw words without understanding'
        ],
        correctAnswerIndex: 0,
        explanation: 'Active recall and conceptual synthesis produce the highest neural consolidation for long-term retention.',
        hint: 'Recall requires active testing rather than passive rereading.'
      },
      nextNodeTitle: null
    }
  ];
}

/**
 * POST /api/generate-path
 * Accepts multipart/form-data with a PDF/document or JSON with text
 */
export const generateStudyPath = async (req, res) => {
  try {
    let rawText = '';
    let fileName = '';

    // 1. Check for uploaded file (pdf, file, document)
    const file = req.file || (req.files && (req.files.pdf?.[0] || req.files.file?.[0] || req.files.document?.[0]));

    if (file) {
      fileName = file.originalname || 'document.pdf';
      console.log(`[generateStudyPath] Processing uploaded file: ${fileName} (${file.size} bytes)`);

      // Use the exact PDF processing system from question generator
      const parsed = await parseDocumentBuffer(file.buffer, file.originalname, file.mimetype);
      rawText = parsed?.text || '';
    } else if (req.body?.text && String(req.body.text).trim().length >= 30) {
      rawText = String(req.body.text).trim();
      fileName = req.body.title || 'Pasted Material';
    }

    if (!rawText || rawText.trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract enough readable text from the provided file or input (minimum 30 characters required).'
      });
    }

    // Determine title
    const explicitTitle = req.body?.title?.trim();
    const derivedTitle = explicitTitle || fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Interactive Study Path';
    const cleanTitle = derivedTitle.charAt(0).toUpperCase() + derivedTitle.slice(1);

    const topicSlug = 'path-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);

    let generatedNodes = null;
    let courseCode = `${cleanTitle.slice(0, 6).toUpperCase()} 101 · Interactive Study Path`;

    // 2. Attempt AI generation
    try {
      const selectedModel = MODEL_REGISTRY.find(m => m.recommended) || MODEL_REGISTRY[0];
      const sampledText = sampleStudyMaterial(rawText, 12000);

      const prompt = studyPathPrompt(sampledText, cleanTitle);
      console.log(`[generateStudyPath] Calling AI (${selectedModel.id}) for study path generation...`);

      const aiResponse = await Promise.race([
        aiClient.chatCompletion({
          model: selectedModel.id,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3500,
          temperature: 0.2
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI generation timed out')), 45000))
      ]);

      const content = aiResponse?.choices?.[0]?.message?.content || '';
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');

      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = content.substring(startIdx, endIdx + 1);
        const parsedData = JSON.parse(jsonStr);

        if (Array.isArray(parsedData.nodes) && parsedData.nodes.length > 0) {
          generatedNodes = parsedData.nodes.map((node, i) => ({
            id: typeof node.id === 'number' ? node.id : i + 1,
            title: node.title || `Concept ${i + 1}`,
            status: i === 0 ? 'active' : 'locked',
            xp: typeof node.xp === 'number' ? node.xp : 20 + i * 5,
            duration: node.duration || `${5 + i * 2} min`,
            summary: node.summary || `Exploration of ${node.title || 'concepts'}.`,
            keyConcepts: Array.isArray(node.keyConcepts) ? node.keyConcepts : ['Key Concept'],
            lessonContent: {
              analogy: node.lessonContent?.analogy || 'A clear mental model for understanding this concept.',
              paragraphs: Array.isArray(node.lessonContent?.paragraphs) && node.lessonContent.paragraphs.length > 0
                ? node.lessonContent.paragraphs
                : ['Foundational details on this concept.'],
              keyConcepts: Array.isArray(node.lessonContent?.keyConcepts)
                ? node.lessonContent.keyConcepts
                : node.keyConcepts || ['Key Concept']
            },
            quiz: {
              question: node.quiz?.question || `What is the key takeaway of ${node.title}?`,
              options: Array.isArray(node.quiz?.options) && node.quiz.options.length === 4
                ? node.quiz.options
                : ['Option A', 'Option B', 'Option C', 'Option D'],
              correctAnswerIndex: typeof node.quiz?.correctAnswerIndex === 'number' ? node.quiz.correctAnswerIndex : 0,
              explanation: node.quiz?.explanation || 'Comprehensive conceptual explanation.',
              hint: node.quiz?.hint || 'Review the core definition.'
            },
            nextNodeTitle: node.nextNodeTitle || (parsedData.nodes[i + 1]?.title ?? null)
          }));

          if (parsedData.courseCode) courseCode = parsedData.courseCode;
        }
      }
    } catch (aiErr) {
      console.warn('[generateStudyPath] AI generation error or timeout, applying robust fallback:', aiErr.message);
    }

    // 3. Fallback to algorithmic generation if AI did not return valid nodes
    if (!generatedNodes || generatedNodes.length === 0) {
      generatedNodes = createFallbackNodes(rawText, cleanTitle);
    }

    const structuredStudyPath = {
      topicId: topicSlug,
      title: cleanTitle,
      courseCode: courseCode,
      currentProgress: 0,
      nodes: generatedNodes
    };

    // 4. Persistence
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.body?.userId || 'anonymous-user';

    try {
      // Deactivate previous active paths for this user
      if (userId && userId !== 'anonymous-user') {
        await StudyPath.updateMany({ userId, isActive: true }, { $set: { isActive: false } });
        await incrementAIUsage(req.user._id).catch(() => {});
        await awardXP(req.user._id, 'ai_study_path').catch(() => {});
      }

      const savedRecord = new StudyPath({
        userId,
        topicId: topicSlug,
        title: cleanTitle,
        courseCode,
        currentProgress: 0,
        nodes: generatedNodes,
        isActive: true,
        sourceFileName: fileName
      });

      await savedRecord.save();
      console.log(`[generateStudyPath] Saved new StudyPath: ${topicSlug} for user ${userId}`);
    } catch (dbErr) {
      console.warn('[generateStudyPath] MongoDB save warning (proceeding with response):', dbErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Study path generated successfully',
      studyPath: structuredStudyPath,
      path: structuredStudyPath,
      topicId: topicSlug
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
 * Returns the active study path for the user
 */
export const getActiveStudyPath = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.firebaseUid || req.query?.userId;

    if (!userId || userId === 'anonymous-user') {
      return res.status(200).json({
        success: true,
        studyPath: null,
        message: 'No authenticated user session'
      });
    }

    const activeRecord = await StudyPath.findOne({ userId, isActive: true }).sort({ updatedAt: -1 }).lean();

    if (!activeRecord) {
      // Return most recent if no active flag
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
      return res.status(404).json({
        success: false,
        message: 'Study path not found'
      });
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
      return res.status(200).json({
        success: true,
        studyPaths: []
      });
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

      // If completed, unlock next node if locked
      if (status === 'completed' && nodeIndex + 1 < pathRecord.nodes.length) {
        if (pathRecord.nodes[nodeIndex + 1].status === 'locked') {
          pathRecord.nodes[nodeIndex + 1].status = 'active';
        }
      }

      // Recalculate progress
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
