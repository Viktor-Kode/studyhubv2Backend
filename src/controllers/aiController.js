import aiClient from '../utils/aiClient.js';
import { quizPrompt, notesPrompt } from '../utils/prompts.js';
import Question from '../models/Question.js';
import QuizSession from '../models/QuizSession.js';
import DocumentHash from '../models/DocumentHash.js';
import StudyNote from '../models/StudyNote.js';
import { AI_PROVIDERS, getModelById, MODEL_REGISTRY } from '../config/aiConfig.js';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

/**
 * Controller to generate study notes.
 */
export const generateNotes = async (req, res) => {
  const { text, modelId } = req.body;

  if (!text || text.trim().length < 50) {
    return res.status(400).json({
      success: false,
      message: 'Text is too short. Please provide at least 50 characters.'
    });
  }

  try {
    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);

    console.log(`📝 Generating Notes for text length: ${text.length} using model: ${selectedModel.id}`);

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: notesPrompt(text) }],
      max_tokens: 2000,
      temperature: 0.3,
    });

    console.log("✅ AI Response received successfully.");
    const notes = response.choices[0].message.content;

    return res.status(200).json({
      success: true,
      notes: notes
    });

  } catch (error) {
    console.error("❌ generateNotes Error Details:", error);
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
  const { text, subject, modelId, amount = 5, questionType = 'multiple-choice', fileName, forceNew = false } = req.body;
  const userId = req.user._id;

  if (!text || text.trim().length < 50) {
    return res.status(400).json({
      success: false,
      message: 'Text is too short. Please provide at least 50 characters.'
    });
  }

  try {
    const textHash = crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
    const existingDoc = await DocumentHash.findOne({ hash: textHash, userId });
    let excludeQuestionContents = [];

    if (existingDoc && existingDoc.quizSessionIds?.length > 0 && !forceNew) {
      const latestSessionId = existingDoc.quizSessionIds[existingDoc.quizSessionIds.length - 1];
      const existingSession = await QuizSession.findOne({ _id: latestSessionId, userId }).populate('questions');

      if (existingSession) {
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

    const questionCount = Math.min(Math.max(parseInt(amount) || 5, 1), 50);
    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);

    let typeInstructions;
    switch (questionType) {
      case 'multiple-choice': typeInstructions = 'multiple-choice questions with 4 options each'; break;
      case 'theory': typeInstructions = 'open-ended theory questions that require detailed explanations'; break;
      case 'fill-in-the-blank': typeInstructions = 'fill-in-the-blank questions with the blank marked as ___'; break;
      case 'mixed': typeInstructions = 'a mix of multiple-choice, theory, and fill-in-the-blank questions'; break;
      default: typeInstructions = 'multiple-choice questions';
    }

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: quizPrompt(text, questionCount, typeInstructions, excludeQuestionContents.slice(0, 20)) }],
      max_tokens: 3000,
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
      const options = q.options || q.choices || [];
      let correctAnswer = q.answer !== undefined ? q.answer : q.correctAnswer;

      // If correctAnswer is text and we have options, find the index
      if (typeof correctAnswer === 'string' && options.length > 0) {
        // Try direct match with option text
        let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());

        // Try letter match (A, B, C, D, E)
        if (idx === -1 && correctAnswer.trim().length === 1) {
          const letterMap = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4 };
          const char = correctAnswer.trim().toLowerCase();
          if (letterMap[char] !== undefined && letterMap[char] < options.length) {
            idx = letterMap[char];
          }
        }

        if (idx !== -1) correctAnswer = idx;
      }

      return {
        teacherId: userId,
        question: q.question || q.content || q.text || q.prompt || "",
        options: options,
        correctAnswer: correctAnswer,
        knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || "No deep-dive available.",
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

    return res.status(201).json({
      success: true,
      isDuplicate: false,
      sessionId: session._id,
      data: savedQuestions
    });

  } catch (error) {
    console.error("❌ generateQuiz Error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Failed to generate quiz" });
  }
};

export const getQuizSessions = async (req, res) => {
  try {
    const userId = req.user._id;
    const sessions = await QuizSession.find({ userId })
      .populate('questions')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: sessions });
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
  const { message, context, chatHistory = [], modelId } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  try {
    const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);
    const systemPrompt = `You are an expert AI Study Tutor. Your goal is to help students understand their study materials. 
    Context: """${context || 'No specific document provided.'}"""`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory.slice(-6),
      { role: "user", content: message }
    ];

    const response = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    return res.status(200).json({ success: true, reply: response.choices[0].message.content });
  } catch (error) {
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

    // 1. Extract text from PDF
    const data = await pdf(req.file.buffer);
    const text = data.text;

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

    // 3. Generate questions using AI
    console.log(`📝 Generating ${numberOfQuestions} questions from PDF for user ${userId}`);
    const aiResponse = await aiClient.chatCompletion({
      model: selectedModel.id,
      messages: [{ role: "user", content: quizPrompt(text.substring(0, 10000), numberOfQuestions, typeInstructions) }],
      max_tokens: 3000,
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
      const options = q.options || q.choices || [];
      let correctAnswer = q.answer !== undefined ? q.answer : q.correctAnswer;

      if (typeof correctAnswer === 'string' && options.length > 0) {
        let idx = options.findIndex(opt => opt && opt.toLowerCase().trim() === correctAnswer.toLowerCase().trim());

        if (idx === -1 && correctAnswer.trim().length === 1) {
          const letterMap = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4 };
          const char = correctAnswer.trim().toLowerCase();
          if (letterMap[char] !== undefined && letterMap[char] < options.length) {
            idx = letterMap[char];
          }
        }

        if (idx !== -1) correctAnswer = idx;
      }

      return {
        teacherId: userId,
        question: q.question || q.content || q.text || q.prompt || "",
        options: options,
        correctAnswer: correctAnswer,
        knowledgeDeepDive: q.knowledgeDeepDive || q.knowledge_deep_dive || q.KnowledgeDeepDive || q.explanation || q.explanationText || q.model_answer || q.modelAnswer || q.solution || q.workingSolution || q.reason || q.note || q.discussion || q.answer_explanation || "No deep-dive available.",
        subject: subject || "General Study",
        difficulty: difficulty,
        type: (q.type || questionType) === 'multiple-choice' ? 'obj' : (q.type || questionType),
        totalMarks: parseInt(marksPerQuestion) || 1,
        source: 'AI'
      };
    });

    const savedQuestions = await Question.insertMany(formattedQuestions);

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