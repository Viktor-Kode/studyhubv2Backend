import Question from '../models/Question.js';
import aiClient from '../utils/aiClient.js';

export const getQuestions = async (req, res) => {
    try {
        const { classId, subject, topic, type, difficulty } = req.query;
        const filter = { teacherId: req.user._id };

        if (classId) filter.classId = classId;
        if (subject) filter.subject = subject;
        if (topic) filter.topic = { $regex: topic, $options: 'i' };
        if (type) filter.type = type;
        if (difficulty) filter.difficulty = difficulty;

        const questions = await Question.find(filter).sort({ createdAt: -1 });
        res.status(200).json({ success: true, questions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createQuestion = async (req, res) => {
    try {
        const body = { ...req.body };
        if (body.questionText) {
            body.question = body.questionText;
            delete body.questionText;
        }
        if (body.options && typeof body.options === 'object' && !Array.isArray(body.options)) {
            body.options = Object.entries(body.options).map(([k, v]) => `${k}. ${v}`);
        }
        if (body.explanation) {
            body.modelAnswer = body.explanation;
            delete body.explanation;
        }
        if (body.type === 'MCQ' || body.type === 'multiple-choice') body.type = 'obj';
        const data = { ...body, teacherId: req.user._id };

        const question = await Question.create(data);
        res.status(201).json({ success: true, question });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const updateQuestion = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.type === 'multiple-choice') updates.type = 'obj';

        const question = await Question.findOneAndUpdate(
            { _id: req.params.id, teacherId: req.user._id },
            updates,
            { new: true }
        );
        if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
        res.status(200).json({ success: true, question });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteQuestion = async (req, res) => {
    try {
        const question = await Question.findOneAndDelete({ _id: req.params.id, teacherId: req.user._id });
        if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
        res.status(200).json({ success: true, message: 'Question deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

function normalizeGeneratedQuestion(q, subject, topic, difficulty, type) {
    const optionsArr = q.options || q.choices || q.answers || [];
    let correctAnswer = q.answer !== undefined ? q.answer : (q.correctAnswer ?? q.correct_answer ?? q.modelAnswer ?? q.model_answer);
    const letters = ['A', 'B', 'C', 'D', 'E'];
    let optionsObj = {};
    if (Array.isArray(optionsArr) && optionsArr.length > 0) {
        optionsArr.forEach((opt, i) => {
            if (opt && letters[i]) optionsObj[letters[i]] = typeof opt === 'string' ? opt : (opt.text || opt.value || String(opt));
        });
        if (typeof correctAnswer === 'number' && correctAnswer < optionsArr.length) {
            correctAnswer = letters[correctAnswer];
        } else if (typeof correctAnswer === 'string') {
            const idx = optionsArr.findIndex(opt => opt && String(opt).toLowerCase().trim() === correctAnswer.toLowerCase().trim());
            if (idx !== -1) correctAnswer = letters[idx];
            else if (correctAnswer.length === 1) {
                const lower = correctAnswer.toLowerCase();
                const letterIdx = letters.findIndex(l => l.toLowerCase() === lower);
                if (letterIdx !== -1 && letterIdx < optionsArr.length) correctAnswer = letters[letterIdx];
            }
        }
    } else if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
        optionsObj = q.options;
    }
    const explanation = q.knowledgeDeepDive || q.knowledge_deep_dive || q.explanation || q.explanationText || q.modelAnswer || q.model_answer || q.solution || q.workingSolution || q.reason || q.note || '';
    const questionText = q.question || q.content || q.text || q.prompt || q.questionText || '';
    const totalMarks = q.totalMarks ?? q.total_marks ?? 1;
    const qType = (type === 'multiple-choice' || type === 'MCQ') ? 'obj' : (type === 'fill-blank' ? 'fill-blank' : type);
    return {
        questionText,
        options: Object.keys(optionsObj).length > 0 ? optionsObj : null,
        correctAnswer: correctAnswer != null ? String(correctAnswer).toUpperCase().charAt(0) : null,
        explanation,
        difficulty: difficulty || q.difficulty || 'medium',
        type: qType,
        totalMarks: typeof totalMarks === 'number' ? totalMarks : 1,
        subject,
        topic
    };
}

export const generateAIQuestions = async (req, res) => {
    try {
        const { subject, topic, difficulty, type, count, classId, dryRun } = req.body;

        const prompt = `Generate ${count} ${type} questions on ${topic} for ${subject}. 
    Difficulty: ${difficulty || 'medium'}. 
    Return a JSON array of objects with the following fields: 
    question, options (array or null for MCQ), correctAnswer, modelAnswer, totalMarks (number), knowledgeDeepDive or explanation (detailed explanation).`;

        const response = await aiClient.generateChatResponse([
            { role: 'system', content: 'You are an educational AI that generates high-quality exam questions in JSON format. Always return a valid JSON array.' },
            { role: 'user', content: prompt }
        ]);

        const jsonString = response.replace(/```json|```/g, '').trim();
        let generatedQuestions = JSON.parse(jsonString);
        if (!Array.isArray(generatedQuestions)) generatedQuestions = [generatedQuestions];

        const normalized = generatedQuestions.map(q => normalizeGeneratedQuestion(q, subject, topic, difficulty, type));

        if (dryRun) {
            return res.status(200).json({ success: true, questions: normalized });
        }

        const toInsert = normalized.map(q => {
            const optArr = q.options && typeof q.options === 'object' && !Array.isArray(q.options)
                ? Object.entries(q.options).map(([k, v]) => `${k}. ${v}`)
                : (Array.isArray(q.options) ? q.options : []);
            return {
                teacherId: req.user._id,
                classId,
                subject: q.subject || subject,
                topic: q.topic || topic,
                difficulty: q.difficulty || difficulty,
                question: q.questionText || '',
                options: optArr,
                correctAnswer: q.correctAnswer,
                modelAnswer: q.explanation,
                totalMarks: q.totalMarks || 1,
                type: q.type || ((type === 'MCQ' || type === 'multiple-choice') ? 'obj' : type),
                source: 'AI'
            };
        });
        const savedQuestions = await Question.insertMany(toInsert);
        res.status(200).json({ success: true, questions: savedQuestions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'AI Generation failed: ' + error.message });
    }
};
