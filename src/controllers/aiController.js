import aiClient from '../utils/aiClient.js';
import { quizPrompt, notesPrompt } from '../utils/prompts.js';
import Question from '../models/Question.js';
import QuizSession from '../models/QuizSession.js';
import DocumentHash from '../models/DocumentHash.js';
import StudyNote from '../models/StudyNote.js';
import CBTResult from '../models/CBTResult.js';
import { AI_PROVIDERS, getModelById, MODEL_REGISTRY } from '../config/aiConfig.js';
import crypto from 'crypto';
import { createRequire } from 'module';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { updateStreak } from '../services/streakService.js';
import { sampleStudyMaterial } from '../utils/studyMaterialSample.js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { parseDocumentBuffer } from '../utils/documentParser.js';
import LibraryDocument from '../models/LibraryDocument.js';

/**
 * Controller to generate study notes.
 */
export const generateNotes = async (req, res) => {
  const { text, documentId, modelId, stream = false } = req.body;
  let contentToUse = text;

  if (documentId) {
    try {
      const doc = await LibraryDocument.findOne({ _id: documentId, userId: req.user._id }).lean();
      if (doc && doc.extractedText) {
        contentToUse = doc.extractedText;
      }
    } catch (err) {
      console.error('[generateNotes] Failed to fetch document:', err.message);
    }
  }

  if (!contentToUse || contentToUse.trim().length < 50) {
    return res.status(400).json({
      success: false,
      message: 'Text is too short. Please provide at least 50 characters.'
    });
  }

  try {
    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);

    const textForModel = sampleStudyMaterial(contentToUse.trim(), 12000);

    console.log(`📝 Generating Notes for text length: ${contentToUse.length} (model input ${textForModel.length}) using model: ${selectedModel.id} (stream=${stream})`);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await aiClient.chatCompletion({
        model: selectedModel.id,
        messages: [{ role: "user", content: notesPrompt(textForModel) }],
        max_tokens: 2000,
        temperature: 0.3,
        stream: true
      });

      let fullNotes = '';
      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullNotes += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // After generation, increment usage and update streak
      await incrementAIUsage(req.user._id);
      await updateStreak(req.user._id, 'question_generator');

      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: notesPrompt(textForModel) }],
      max_tokens: 2000,
      temperature: 0.3,
    });

    console.log("✅ AI Response received successfully.");
    const notes = response.choices[0].message.content;

    await incrementAIUsage(req.user._id);
    const streak = await updateStreak(req.user._id, 'question_generator');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const lastDate = streak?.lastActivityDate
      ? new Date(streak.lastActivityDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      : null;

    return res.status(200).json({
      success: true,
      notes: notes,
      streak: streak ? { current: streak.currentStreak || 0, longest: streak.longestStreak || 0, studiedToday: lastDate === today } : null
    });

  } catch (error) {
    console.error("❌ generateNotes Error Details:", error);
    if (stream && !res.headersSent) {
      return res.status(500).json({ success: false, message: error.message || "Failed to generate notes" });
    } else if (stream) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate notes"
    });
  }
};

/**
 * Save study notes to the database.
 */
export const saveStudyNote = async (req, res) => {
  const { title, content, sourceFileName, tags } = req.body;
  const userId = req.user._id;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: 'Title and content are required.' });
  }

  try {
    const newNote = new StudyNote({
      userId,
      title,
      content,
      sourceFileName,
      tags: tags || []
    });

    await newNote.save();
    return res.status(201).json({ success: true, note: newNote });
  } catch (error) {
    console.error("❌ saveStudyNote Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to save study note" });
  }
};

/**
 * Fetch study notes - filtered by user.
 */
export const getStudyNotes = async (req, res) => {
  try {
    const userId = req.user._id;
    const notes = await StudyNote.find({ userId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, notes });
  } catch (error) {
    console.error("❌ getStudyNotes Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch study notes" });
  }
};

/**
 * Delete a study note - only if it belongs to the user.
 */
export const deleteStudyNote = async (req, res) => {
  try {
    const userId = req.user._id;
    const deleted = await StudyNote.findOneAndDelete({ _id: req.params.id, userId });

    if (!deleted) return res.status(404).json({ success: false, message: 'Note not found or not authorized' });
    return res.status(200).json({ success: true, message: 'Study note deleted' });
  } catch (error) {
    console.error("❌ deleteStudyNote Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete study note" });
  }
};

/**
 * Controller to generate quiz questions.
 */
export const generateQuiz = async (req, res) => {
  const { text, documentId, subject, modelId, amount = 5, questionType = 'multiple-choice', fileName, forceNew = false, stream = false } = req.body;
  const userId = req.user._id;

  let contentToUse = text;

  if (documentId) {
    try {
      const doc = await LibraryDocument.findOne({ _id: documentId, userId }).lean();
      if (doc && doc.extractedText) {
        contentToUse = doc.extractedText;
      }
    } catch (err) {
      console.error('[generateQuiz] Failed to fetch document:', err.message);
    }
  }

  if (!contentToUse || contentToUse.trim().length < 50) {
    return res.status(400).json({
      success: false,
      message: 'Text is too short. Please provide at least 50 characters.'
    });
  }

  try {
    const textHash = crypto.createHash('sha256').update(contentToUse.trim().toLowerCase()).digest('hex');
    const existingDoc = await DocumentHash.findOne({ hash: textHash, userId });
    let excludeQuestionContents = [];

    const questionCount = Math.min(Math.max(parseInt(amount) || 5, 1), 50);

    if (existingDoc && existingDoc.quizSessionIds?.length > 0 && !forceNew) {
      const latestSessionId = existingDoc.quizSessionIds[existingDoc.quizSessionIds.length - 1];
      const existingSession = await QuizSession.findOne({ _id: latestSessionId, userId }).populate('questions');
      
      if (existingSession && existingSession.questions.length >= questionCount) {
        return res.status(200).json({
          success: true,
          message: 'Returning existing questions.',
          isDuplicate: true,
          sessionId: existingSession._id,
          data: existingSession.questions
        });
      }
    }

    // Logic for excluding questions if forceNew
    if (existingDoc && forceNew) {
      const previousSessions = await QuizSession.find({
        _id: { $in: existingDoc.quizSessionIds },
        userId
      }).populate('questions');

      previousSessions.forEach(session => {
        session.questions.forEach(q => excludeQuestionContents.push(q.content));
      });
    }

    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);

    const textForModel = sampleStudyMaterial(contentToUse.trim(), 14000);

    let typeInstructions;
    switch (questionType) {
      case 'multiple-choice': typeInstructions = 'multiple-choice questions with 4 options each'; break;
      case 'theory': typeInstructions = 'open-ended theory questions that require detailed explanations'; break;
      case 'fill-in-the-blank': typeInstructions = 'fill-in-the-blank questions with the blank marked as ___'; break;
      case 'mixed': typeInstructions = 'a mix of multiple-choice, theory, and fill-in-the-blank questions'; break;
      default: typeInstructions = 'multiple-choice questions';
    }

    const aiPrompt = quizPrompt(textForModel, questionCount, typeInstructions, excludeQuestionContents.slice(0, 20));

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await aiClient.chatCompletion({
        model: selectedModel.id,
        messages: [{ role: "user", content: aiPrompt }],
        max_tokens: Math.min(8192, 1200 + questionCount * 450),
        temperature: 0.7,
        stream: true
      });

      let fullAiContent = '';
      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullAiContent += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // After stream completes, process and save to DB
      console.log(`✅ AI Stream complete for quiz. Processing ${fullAiContent.length} chars...`);
      
      // Send a small heartbeat to keep connection alive during processing
      res.write(`data: ${JSON.stringify({ status: 'processing' })}\n\n`);

      try {
        const startIdx = fullAiContent.indexOf('[');
        const endIdx = fullAiContent.lastIndexOf(']');
        let cleanJsonString = fullAiContent;
        if (startIdx !== -1 && endIdx !== -1) {
          cleanJsonString = fullAiContent.substring(startIdx, endIdx + 1);
        } else {
          cleanJsonString = fullAiContent.replace(/```json|```/g, "").trim();
        }

        const parsedQuestions = JSON.parse(cleanJsonString);
        const formattedQuestions = parsedQuestions.map((q) => {
          const options = q.options || q.choices || q.answers || [];
          let correctAnswer = q.answer !== undefined ? q.answer : (q.correctAnswer !== undefined ? q.correctAnswer : (q.correct_answer !== undefined ? q.correct_answer : (q.modelAnswer !== undefined ? q.modelAnswer : q.model_answer)));

          if (typeof correctAnswer === 'string' && options.length > 0) {
            let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());
            if (idx === -1) {
              const trimmed = correctAnswer.trim().toUpperCase();
              // 1. Try match at start like "A. text" or "A)" or just "A"
              const startMatch = trimmed.match(/^([A-E])([\s\.)-]|$)/);
              if (startMatch) {
                const letter = startMatch[1];
                const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
                if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
                  idx = letterMap[letter];
                }
              } else {
                // 2. Try finding "Answer: B" or similar patterns anywhere in the string
                const patternMatch = trimmed.match(/ANSWER[:\s]+([A-E])\b/) || trimmed.match(/\b([A-E])\b/);
                if (patternMatch) {
                  const letter = patternMatch[1];
                  const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
                  if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
                    idx = letterMap[letter];
                  }
                } else if (!isNaN(parseInt(trimmed)) && parseInt(trimmed) < options.length) {
                   // 3. Try numeric index
                   idx = parseInt(trimmed);
                }
              }
            }
            if (idx !== -1) correctAnswer = idx;
          }

          return {
            teacherId: userId,
            question: q.question || q.content || q.text || q.prompt || q.questionText || "",
            options: options,
            correctAnswer: correctAnswer,
            knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || q.commentary || "No deep-dive available.",
            subject: subject || "General Study",
            type: questionType === 'multiple-choice' ? 'obj' : (questionType === 'theory' ? 'theory' : (questionType === 'fill-in-the-blank' ? 'fill-blank' : questionType))
          };
        });

        const savedQuestions = await Question.insertMany(formattedQuestions);
        const session = new QuizSession({
          userId,
          title: `${questionType.charAt(0).toUpperCase() + questionType.slice(1)} Quiz - ${new Date().toLocaleDateString()}`,
          questionType,
          questionCount: savedQuestions.length,
          questions: savedQuestions.map(q => q._id)
        });
        await session.save();

        if (existingDoc) {
          existingDoc.quizSessionIds.push(session._id);
          await existingDoc.save();
        } else {
          await DocumentHash.create({
            hash: textHash,
            userId,
            fileName: fileName || 'unknown',
            quizSessionIds: [session._id]
          });
        }

        await incrementAIUsage(req.user._id, savedQuestions.length);
        await updateStreak(req.user._id, 'question_generator');

        // Send final metadata
        res.write(`data: ${JSON.stringify({ sessionId: session._id, done: true, questions: savedQuestions })}\n\n`);
      } catch (err) {
        console.error("❌ generateQuiz Parsing Error:", err.message);
        res.write(`data: ${JSON.stringify({ error: "Failed to parse generated questions. Please try again." })}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: aiPrompt }],
      max_tokens: Math.min(8192, 1200 + questionCount * 450),
      temperature: 0.7,
    });

    const aiContent = response.choices[0].message.content;
    const startIdx = aiContent.indexOf('[');
    const endIdx = aiContent.lastIndexOf(']');
    let cleanJsonString = aiContent;
    if (startIdx !== -1 && endIdx !== -1) {
      cleanJsonString = aiContent.substring(startIdx, endIdx + 1);
    } else {
      cleanJsonString = aiContent.replace(/```json|```/g, "").trim();
    }

    const parsedQuestions = JSON.parse(cleanJsonString);
    const formattedQuestions = parsedQuestions.map((q) => {
      const options = q.options || q.choices || q.answers || [];
      let correctAnswer = q.answer !== undefined ? q.answer : (q.correctAnswer !== undefined ? q.correctAnswer : (q.correct_answer !== undefined ? q.correct_answer : (q.modelAnswer !== undefined ? q.modelAnswer : q.model_answer)));

      // Convert text/letter answer to index if options exist
      if (typeof correctAnswer === 'string' && options.length > 0) {
        let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());

        if (idx === -1) {
          const trimmed = correctAnswer.trim().toUpperCase();
          // 1. Try match at start like "A. text" or "A)" or just "A"
          const startMatch = trimmed.match(/^([A-E])([\s\.)-]|$)/);
          if (startMatch) {
            const letter = startMatch[1];
            const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
            if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
              idx = letterMap[letter];
            }
          } else {
            // 2. Try finding "Answer: B" or similar patterns anywhere
            const patternMatch = trimmed.match(/ANSWER[:\s]+([A-E])\b/) || trimmed.match(/\b([A-E])\b/);
            if (patternMatch) {
              const letter = patternMatch[1];
              const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
              if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
                idx = letterMap[letter];
              }
            } else if (!isNaN(parseInt(trimmed)) && parseInt(trimmed) < options.length) {
               // 3. Try numeric index
               idx = parseInt(trimmed);
            }
          }
        }
        if (idx !== -1) correctAnswer = idx;
      }

      return {
        teacherId: userId,
        question: q.question || q.content || q.text || q.prompt || q.questionText || "",
        options: options,
        correctAnswer: correctAnswer,
        knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || q.commentary || "No deep-dive available.",
        subject: subject || "General Study",
        type: questionType === 'multiple-choice' ? 'obj' : (questionType === 'theory' ? 'theory' : (questionType === 'fill-in-the-blank' ? 'fill-blank' : questionType))
      };
    });

    const savedQuestions = await Question.insertMany(formattedQuestions);

    const session = new QuizSession({
      userId,
      title: `${questionType.charAt(0).toUpperCase() + questionType.slice(1)} Quiz - ${new Date().toLocaleDateString()}`,
      questionType,
      questionCount: savedQuestions.length,
      questions: savedQuestions.map(q => q._id)
    });
    await session.save();

    if (existingDoc) {
      existingDoc.quizSessionIds.push(session._id);
      await existingDoc.save();
    } else {
      await DocumentHash.create({
        hash: textHash,
        userId,
        fileName: fileName || 'unknown',
        quizSessionIds: [session._id]
      });
    }

    await incrementAIUsage(req.user._id, savedQuestions.length);
    const streak = await updateStreak(req.user._id, 'question_generator');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const lastDate = streak?.lastActivityDate
      ? new Date(streak.lastActivityDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      : null;

    return res.status(201).json({
      success: true,
      isDuplicate: false,
      sessionId: session._id,
      data: savedQuestions,
      streak: streak ? { current: streak.currentStreak || 0, longest: streak.longestStreak || 0, studiedToday: lastDate === today } : null
    });

  } catch (error) {
    console.error("❌ generateQuiz Error:", error.message);
    if (stream && !res.headersSent) {
      return res.status(500).json({ success: false, message: error.message || "Failed to generate quiz" });
    } else if (stream) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ success: false, message: error.message || "Failed to generate quiz" });
  }
};

export const getQuizSessions = async (req, res) => {
  try {
    const userId = req.user._id;
    const sessions = await QuizSession.find({ userId })
      .populate('questions')
      .sort({ createdAt: -1 });
    
    // Fetch latest results for these sessions to show user answers/score in history
    const sessionIds = sessions.map(s => s._id);
    const results = await CBTResult.find({ 
        studentId: userId, 
        sessionId: { $in: sessionIds } 
    }).sort({ takenAt: -1 });

    const sessionsWithResults = sessions.map(session => {
        const sessionObj = session.toObject();
        // Find the most recent result for this session
        const latestResult = results.find(r => r.sessionId && r.sessionId.toString() === session._id.toString());
        if (latestResult) {
            sessionObj.lastResult = latestResult;
        }
        return sessionObj;
    });

    res.json({ success: true, data: sessionsWithResults });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getQuizSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const session = await QuizSession.findOne({ _id: req.params.id, userId }).populate('questions');
    if (!session) return res.status(404).json({ success: false, message: 'Quiz session not found' });
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteQuizSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const session = await QuizSession.findOne({ _id: req.params.id, userId });

    if (!session) return res.status(404).json({ success: false, message: 'Quiz session not found' });

    await Question.deleteMany({ _id: { $in: session.questions }, teacherId: userId });
    await DocumentHash.updateOne({ userId, quizSessionIds: session._id }, { $pull: { quizSessionIds: session._id } });
    await session.deleteOne();

    res.json({ success: true, message: 'Quiz session deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const chatWithTutor = async (req, res) => {
  const { message, context, documentId, chatHistory = [], modelId, stream = false } = req.body;
  let contextToUse = context;

  if (documentId) {
    try {
      const doc = await LibraryDocument.findOne({ _id: documentId, userId: req.user._id }).lean();
      if (doc && doc.extractedText) {
        contextToUse = doc.extractedText;
      }
    } catch (err) {
      console.error('[chatWithTutor] Failed to fetch document:', err.message);
    }
  }

  if (!message) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  try {
    console.log(`💬 chatWithTutor: msg="${message.substring(0, 30)}...", model=${modelId}, stream=${stream}, history=${chatHistory?.length}`);
    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);
    const contextForModel = contextToUse
      ? sampleStudyMaterial(String(contextToUse), 8000)
      : 'No specific document provided.';
    const systemPrompt = `You are an expert AI Study Tutor. Your goal is to help students understand their study materials. 
    Context: """${contextForModel}"""

At the end of every response, append suggested follow-up questions in this exact format on the last line:
[[Question one?||Question two?||Question three?]]
These should be natural follow-ups a Nigerian secondary school or university student would ask next.
Do not number them or add any text before the [[ brackets.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory.slice(-6),
      { role: "user", content: message }
    ];

    console.log(`💬 Tutor Chat: stream=${stream} using ${selectedModel.id}`);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await aiClient.chatCompletion({
        model: selectedModel.id,
        messages,
        max_tokens: 1200,
        temperature: 0.7,
        stream: true
      });

      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      await incrementAIUsage(req.user._id);
      await updateStreak(req.user._id, 'question_generator');

      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    });
    const reply = response.choices[0].message.content;

    await incrementAIUsage(req.user._id);
    const streak = await updateStreak(req.user._id, 'question_generator');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const lastDate = streak?.lastActivityDate
      ? new Date(streak.lastActivityDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      : null;

    return res.status(200).json({
      success: true,
      reply,
      streak: streak ? { current: streak.currentStreak || 0, longest: streak.longestStreak || 0, studiedToday: lastDate === today } : null
    });
  } catch (error) {
    console.error("❌ chatWithTutor Error:", error);
    if (stream && !res.headersSent) {
      return res.status(500).json({ success: false, message: error.message || "Tutor offline" });
    } else if (stream) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ success: false, message: error.message || "Tutor offline" });
  }
};

export const getQuestions = async (req, res) => {
  try {
    const userId = req.user._id;
    const questions = await Question.find({ teacherId: userId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: questions.length, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    const userId = req.user._id;
    const deleted = await Question.findOneAndDelete({ _id: req.params.id, teacherId: userId });
    if (!deleted) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.status(200).json({ success: true, message: 'Question deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const fetchUrlContent = async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({
      error: 'Please provide a valid URL starting with http',
      success: false,
    });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StudyHelp/1.0)',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      return res
        .status(502)
        .json({ error: `Could not fetch that URL (status ${response.status})` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $('title').text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled Page';

    $('script, style, nav, footer, header, aside, iframe, noscript, .ad, .advertisement, .sidebar').remove();

    const mainSelectors = [
      'article',
      'main',
      '.content',
      '.post-content',
      '#content',
      '.entry-content',
      '#mw-content-text',
    ];

    let text = '';
    for (const sel of mainSelectors) {
      if ($(sel).length) {
        text = $(sel).text();
        break;
      }
    }

    if (!text || text.length < 200) {
      text = $('body').text();
    }

    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length > 8000) {
      text = text.substring(0, 8000) + '... [content truncated]';
    }

    if (text.length < 100) {
      return res.status(422).json({
        error:
          'Could not extract readable content from that URL. Try copying and pasting the text manually.',
      });
    }

    return res.json({
      text,
      title,
      chars: text.length,
      success: true,
    });
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
    console.error('[FetchURL]', message);

    if (message.toLowerCase().includes('timeout')) {
      return res.status(504).json({
        error: 'That page took too long to load. Try a different link.',
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch content from that URL.',
    });
  }
};

/**
 * Generate questions from a PDF file.
 */
export const generateQuestionsFromPDF = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No PDF file uploaded' });
    }

    const {
      difficulty = 'medium',
      questionType = 'multiple-choice',
      numberOfQuestions = 5,
      subject = 'General',
      assessmentType = 'assignment',
      marksPerQuestion = 1
    } = req.body;

    const userId = req.user._id;

    // 1. Extract text from document
    let text = '';
    const parsed = await parseDocumentBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    text = parsed.text;

    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        success: false,
        message: 'The PDF does not contain enough readable text.'
      });
    }

    // 2. Prepare instructions
    let typeInstructions;
    switch (questionType) {
      case 'multiple-choice': typeInstructions = 'multiple-choice questions with 4 options each'; break;
      case 'theory': typeInstructions = 'open-ended theory questions'; break;
      case 'fill-in-gap': typeInstructions = 'fill-in-the-gap questions with the blank marked as ___'; break;
      case 'all': typeInstructions = 'a mix of multiple-choice, theory, and fill-in-the-gap questions'; break;
      default: typeInstructions = 'multiple-choice questions';
    }

    const selectedModel = MODEL_REGISTRY.find(m => m.recommended) || MODEL_REGISTRY[0];

    const questionCount = Math.min(Math.max(parseInt(numberOfQuestions) || 5, 1), 50);

    // 3. Generate questions using AI
    console.log(`📝 Generating ${questionCount} questions from PDF for user ${userId} (stream=${req.body.stream})`);
    const textForModel = sampleStudyMaterial(text.trim(), 10000);
    const aiPrompt = quizPrompt(textForModel, questionCount, typeInstructions);

    if (req.body.stream === 'true' || req.body.stream === true) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await aiClient.chatCompletion({
        model: selectedModel.id,
        messages: [{ role: "user", content: aiPrompt }],
        max_tokens: Math.min(8192, 1200 + questionCount * 450),
        temperature: 0.7,
        stream: true
      });

      let fullAiContent = '';
      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullAiContent += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      console.log(`✅ AI Stream complete for PDF quiz. Processing ${fullAiContent.length} chars...`);
      res.write(`data: ${JSON.stringify({ status: 'processing' })}\n\n`);

      try {
        const startIdx = fullAiContent.indexOf('[');
        const endIdx = fullAiContent.lastIndexOf(']');
        let cleanJsonString = fullAiContent;
        if (startIdx !== -1 && endIdx !== -1) {
          cleanJsonString = fullAiContent.substring(startIdx, endIdx + 1);
        } else {
          cleanJsonString = fullAiContent.replace(/```json|```/g, "").trim();
        }

        const parsedQuestions = JSON.parse(cleanJsonString);
        const formattedQuestions = parsedQuestions.map((q) => {
          const options = q.options || q.choices || q.answers || [];
          let correctAnswer = q.answer !== undefined ? q.answer : (q.correctAnswer !== undefined ? q.correctAnswer : (q.correct_answer !== undefined ? q.correct_answer : (q.modelAnswer !== undefined ? q.modelAnswer : q.model_answer)));

          if (typeof correctAnswer === 'string' && options.length > 0) {
            let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());
            if (idx === -1) {
              const trimmed = correctAnswer.trim().toUpperCase();
              // 1. Try match at start
              const startMatch = trimmed.match(/^([A-E])([\s\.)-]|$)/);
              if (startMatch) {
                const letter = startMatch[1];
                const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
                if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
                  idx = letterMap[letter];
                }
              } else {
                // 2. Try patterns
                const patternMatch = trimmed.match(/ANSWER[:\s]+([A-E])\b/) || trimmed.match(/\b([A-E])\b/);
                if (patternMatch) {
                  const letter = patternMatch[1];
                  const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4 };
                  if (letterMap[letter] !== undefined && letterMap[letter] < options.length) {
                    idx = letterMap[letter];
                  }
                } else if (!isNaN(parseInt(trimmed)) && parseInt(trimmed) < options.length) {
                  idx = parseInt(trimmed);
                }
              }
            }
            if (idx !== -1) correctAnswer = idx;
          }

          return {
            teacherId: userId,
            question: q.question || q.content || q.text || q.prompt || q.questionText || "",
            options: options,
            correctAnswer: correctAnswer,
            knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || q.commentary || "No deep-dive available.",
            subject: subject || "General Study",
            difficulty: difficulty,
            type: (q.type || questionType) === 'multiple-choice' ? 'obj' : (q.type || questionType === 'multiple-choice' ? 'obj' : (questionType === 'theory' ? 'theory' : (questionType === 'fill-in-the-gap' ? 'fill-blank' : questionType))),
            totalMarks: parseInt(marksPerQuestion) || 1,
            source: 'AI'
          };
        });

        const savedQuestions = await Question.insertMany(formattedQuestions);
        await incrementAIUsage(req.user._id, savedQuestions.length);

        res.write(`data: ${JSON.stringify({ questions: savedQuestions, done: true })}\n\n`);
      } catch (err) {
        console.error("❌ generateQuestionsFromPDF Parsing Error:", err.message);
        res.write(`data: ${JSON.stringify({ error: "Failed to parse generated questions." })}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const aiResponse = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: aiPrompt }],
      max_tokens: Math.min(8192, 1200 + questionCount * 450),
      temperature: 0.7,
    });

    const aiContent = aiResponse.choices[0].message.content;

    // Clean up JSON
    const startIdx = aiContent.indexOf('[');
    const endIdx = aiContent.lastIndexOf(']');
    let cleanJsonString = aiContent;
    if (startIdx !== -1 && endIdx !== -1) {
      cleanJsonString = aiContent.substring(startIdx, endIdx + 1);
    } else {
      cleanJsonString = aiContent.replace(/```json|```/g, "").trim();
    }

    const parsedQuestions = JSON.parse(cleanJsonString);

    // 4. Format and Save to DB
    const formattedQuestions = parsedQuestions.map((q) => {
      const options = q.options || q.choices || q.answers || [];
      let correctAnswer = q.answer !== undefined ? q.answer : (q.correctAnswer !== undefined ? q.correctAnswer : (q.correct_answer !== undefined ? q.correct_answer : (q.modelAnswer !== undefined ? q.modelAnswer : q.model_answer)));

      // Convert text/letter answer to index if options exist
      if (typeof correctAnswer === 'string' && options.length > 0) {
        let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());

        if (idx === -1) {
          const trimmed = correctAnswer.trim().toLowerCase();
          // Try handles "0", "1", etc.
          if (!isNaN(parseInt(trimmed)) && parseInt(trimmed) < options.length) {
            idx = parseInt(trimmed);
          } else if (trimmed.length === 1) {
            // Try handles "A", "B", etc.
            const letterMap = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4 };
            if (letterMap[trimmed] !== undefined && letterMap[trimmed] < options.length) {
              idx = letterMap[trimmed];
            }
          }
        }
        if (idx !== -1) correctAnswer = idx;
      }

      return {
        teacherId: userId,
        question: q.question || q.content || q.text || q.prompt || q.questionText || "",
        options: options,
        correctAnswer: correctAnswer,
        knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || q.commentary || "No deep-dive available.",
        subject: subject || "General Study",
        difficulty: difficulty,
        type: (q.type || questionType) === 'multiple-choice' ? 'obj' : (q.type || questionType === 'multiple-choice' ? 'obj' : (questionType === 'theory' ? 'theory' : (questionType === 'fill-in-the-gap' ? 'fill-blank' : questionType))),
        totalMarks: parseInt(marksPerQuestion) || 1,
        source: 'AI'
      };
    });

    const savedQuestions = await Question.insertMany(formattedQuestions);

    // Count this as one AI usage
    await incrementAIUsage(req.user._id, savedQuestions.length);

    return res.status(201).json({
      success: true,
      questions: savedQuestions,
      message: `Successfully generated ${savedQuestions.length} questions.`
    });

  } catch (error) {
    console.error("❌ generateQuestionsFromPDF Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate questions from PDF"
    });
  }
};