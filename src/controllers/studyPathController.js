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
      quiz2: {
        question: `How does mastering the fundamental principles of ${cleanTitle} impact practical performance?`,
        options: [
          'It enables systematic problem-solving and reduces implementation errors',
          'It replaces the need for any practical execution or testing',
          'It is only useful for theoretical examinations, not real tasks',
          'It makes system performance unpredictable'
        ],
        correctAnswerIndex: 0,
        explanation: 'Grounding in fundamentals allows students to troubleshoot issues rapidly and design reliable solutions.',
        hint: 'Think about the link between theory and debugging.'
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
      quiz2: {
        question: `When system operations encounter unexpected state transitions in ${cleanTitle}, what is the best practice?`,
        options: [
          'Validate state invariants and enforce deterministic transition guards',
          'Silently ignore state changes and let execution continue',
          'Reset the system without logging the error condition',
          'Disable state validation checks'
        ],
        correctAnswerIndex: 0,
        explanation: 'Enforcing deterministic state validation ensures predictability and isolates errors before cascading failures occur.',
        hint: 'Think about ensuring stability and invariants.'
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
      quiz2: {
        question: `In applied optimization for ${cleanTitle}, which factor yields the most sustainable performance gains?`,
        options: [
          'Addressing architectural bottlenecks and reducing redundant operations',
          'Micro-optimizing unrelated routines without profiling',
          'Removing error logging to save clock cycles',
          'Increasing resource consumption without limits'
        ],
        correctAnswerIndex: 0,
        explanation: 'Targeting verified architectural bottlenecks produces measurable, robust improvements over micro-optimizations.',
        hint: 'Think about profiling before optimizing.'
      },
      nextNodeTitle: 'Summary & Review'
    },
    {
      id: 4,
      title: 'Summary & Review',
      status: 'locked',
      xp: 35,
      duration: '8 min',
      isSummary: true,
      summary: `Comprehensive review of all key concepts covered in ${cleanTitle}, including foundational principles, mechanisms, and applied problem solving.`,
      keyConcepts: ['Definition', 'Fundamental Principles', 'Core Terminology', 'System Operations', 'Internal State', 'Real-world Scenarios', 'Edge Cases'],
      lessonContent: {
        analogy: `Think of this as your study guide — connecting all the dots from ${cleanTitle} into one cohesive picture.`,
        paragraphs: [
          p1.slice(0, 200) || 'We started with foundational concepts and core terminology.',
          p2.slice(0, 200) || 'Then explored the internal mechanisms and workflows.',
          p3.slice(0, 200) || 'Finally, we applied these concepts to real-world problem solving.',
          'Now it is time to bring it all together and prepare for the final assessment.'
        ],
        keyConcepts: ['Definition', 'Fundamental Principles', 'System Operations', 'Real-world Scenarios']
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
      nextNodeTitle: 'Final Assessment'
    },
    {
      id: 5,
      title: 'Final Assessment',
      status: 'locked',
      xp: 100,
      duration: '15 min',
      isFinalQuiz: true,
      summary: 'Complete this 10-question assessment to demonstrate mastery of all concepts.',
      keyConcepts: ['Comprehensive Review', 'Applied Knowledge', 'Critical Thinking'],
      lessonContent: {
        analogy: 'This is your final exam — like the boss level in a game, it tests everything you have learned.',
        paragraphs: [
          'This assessment covers all concepts from the entire learning path.',
          'Answer all 10 questions to complete the map and earn maximum XP.'
        ],
        keyConcepts: ['Full Mastery', 'Comprehensive Assessment']
      },
      finalQuiz: [
        {
          question: `What is the primary foundation of ${cleanTitle}?`,
          options: ['Core foundational principles', 'Arbitrary guidelines', 'Unrelated facts', 'Historical trivia only'],
          correctAnswerIndex: 0,
          explanation: 'Foundational principles form the base for all advanced concepts.',
          hint: 'Think about what comes first in learning.'
        },
        {
          question: `How do internal mechanisms operate in ${cleanTitle}?`,
          options: ['Through structured state transitions', 'Randomly without pattern', 'Only with manual triggers', 'Without any state'],
          correctAnswerIndex: 0,
          explanation: 'Structured transitions ensure predictable system behavior.',
          hint: 'Think systematic.'
        },
        {
          question: 'What is the best approach to edge cases?',
          options: ['Systematic diagnosis and boundary verification', 'Ignore them', 'Restart from scratch', 'Disable checks'],
          correctAnswerIndex: 0,
          explanation: 'Systematic approaches catch boundary issues reliably.',
          hint: 'Think about testing boundaries.'
        },
        {
          question: 'Why is active recall effective for retention?',
          options: ['It strengthens neural pathways through testing', 'It is easier than reading', 'It requires no effort', 'It only works short-term'],
          correctAnswerIndex: 0,
          explanation: 'Active testing consolidates memory more effectively than passive review.',
          hint: 'Think about how testing strengthens memory.'
        },
        {
          question: `Which best describes the core terminology of ${cleanTitle}?`,
          options: ['Precise definitions that enable clear communication', 'Vague labels with no standard meaning', 'Numbers only', 'Informal slang terms'],
          correctAnswerIndex: 0,
          explanation: 'Precise terminology ensures shared understanding.',
          hint: 'Think about clarity.'
        },
        {
          question: 'What role do workflows play in system operations?',
          options: ['They provide repeatable, efficient processes', 'They add unnecessary complexity', 'They are purely decorative', 'They only apply to large systems'],
          correctAnswerIndex: 0,
          explanation: 'Workflows standardize operations for consistency and efficiency.',
          hint: 'Think about repeatability.'
        },
        {
          question: 'How should you approach a concept you do not fully understand?',
          options: ['Break it into smaller parts and review fundamentals', 'Skip it entirely', 'Memorize without understanding', 'Only revisit before exams'],
          correctAnswerIndex: 0,
          explanation: 'Decomposing complex ideas into fundamentals builds genuine understanding.',
          hint: 'Think about building blocks.'
        },
        {
          question: 'What distinguishes applied knowledge from theoretical knowledge?',
          options: ['Applied knowledge solves real problems using theory', 'They are identical', 'Theory is always more useful', 'Applied knowledge ignores theory'],
          correctAnswerIndex: 0,
          explanation: 'Application bridges theory and practice for real-world impact.',
          hint: 'Think about using what you learn.'
        },
        {
          question: 'Why is synthesizing concepts across nodes important?',
          options: ['It reveals connections and deepens understanding', 'It wastes time', 'Each concept is completely independent', 'It only helps with memorization'],
          correctAnswerIndex: 0,
          explanation: 'Cross-concept synthesis reveals patterns and strengthens overall mastery.',
          hint: 'Think about connecting the dots.'
        },
        {
          question: `What is the ultimate goal of mastering ${cleanTitle}?`,
          options: ['Confident, independent application of all core concepts', 'Passing a single test', 'Memorizing all definitions', 'Reading all material once'],
          correctAnswerIndex: 0,
          explanation: 'True mastery means confident independent application, not just recall.',
          hint: 'Think beyond memorization.'
        }
      ],
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

    // 1. Check for client pre-extracted text or uploaded file
    const file = req.file || (req.files && (req.files.pdf?.[0] || req.files.file?.[0] || req.files.document?.[0]));

    if (req.body?.text && String(req.body.text).trim().length >= 30) {
      rawText = String(req.body.text).trim();
      fileName = file?.originalname || req.body.title || 'Study Material';
      console.log(`[generateStudyPath] Using pre-extracted text for: ${fileName} (${rawText.length} chars)`);
    } else if (file) {
      fileName = file.originalname || 'document.pdf';
      console.log(`[generateStudyPath] Processing uploaded file: ${fileName} (${file.size} bytes)`);

      // Use document parser supporting PDF, DOCX, PPTX, TXT
      const parsed = await parseDocumentBuffer(file.buffer, file.originalname, file.mimetype);
      rawText = parsed?.text || '';
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
          max_tokens: 6000,
          temperature: 0.2
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI generation timed out')), 60000))
      ]);

      const content = aiResponse?.choices?.[0]?.message?.content || '';
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');

      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = content.substring(startIdx, endIdx + 1);
        const parsedData = JSON.parse(jsonStr);

        if (Array.isArray(parsedData.nodes) && parsedData.nodes.length > 0) {
          generatedNodes = parsedData.nodes.map((node, i) => {
            const baseNode = {
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
              quiz2: node.quiz2?.question ? {
                question: node.quiz2.question,
                options: Array.isArray(node.quiz2.options) && node.quiz2.options.length === 4
                  ? node.quiz2.options
                  : ['Option A', 'Option B', 'Option C', 'Option D'],
                correctAnswerIndex: typeof node.quiz2.correctAnswerIndex === 'number' ? node.quiz2.correctAnswerIndex : 0,
                explanation: node.quiz2.explanation || 'Practical application of this concept.',
                hint: node.quiz2.hint || 'Consider how this applies in practice.'
              } : undefined,
              nextNodeTitle: node.nextNodeTitle || (parsedData.nodes[i + 1]?.title ?? null)
            };

            // Preserve isSummary flag
            if (node.isSummary) {
              baseNode.isSummary = true;
            }

            // Preserve isFinalQuiz flag and finalQuiz array
            if (node.isFinalQuiz) {
              baseNode.isFinalQuiz = true;
              if (Array.isArray(node.finalQuiz) && node.finalQuiz.length > 0) {
                baseNode.finalQuiz = node.finalQuiz.map(fq => ({
                  question: fq.question || 'Assessment question',
                  options: Array.isArray(fq.options) && fq.options.length === 4
                    ? fq.options
                    : ['Option A', 'Option B', 'Option C', 'Option D'],
                  correctAnswerIndex: typeof fq.correctAnswerIndex === 'number' ? fq.correctAnswerIndex : 0,
                  explanation: fq.explanation || 'Review the core concepts.',
                  hint: fq.hint || 'Think carefully about the material.'
                }));
              }
            }

            return baseNode;
          });

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
