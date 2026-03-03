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
        const data = { ...req.body, teacherId: req.user._id };
        if (data.type === 'multiple-choice') data.type = 'obj';

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

export const generateAIQuestions = async (req, res) => {
    try {
        const { subject, topic, difficulty, type, count, classId } = req.body;

        const prompt = `Generate ${count} ${type} questions on ${topic} for ${subject}. 
    Difficulty: ${difficulty}. 
    Return a JSON array of objects with the following fields: 
    question, options (array or null), correctAnswer, modelAnswer, workingSolution, markingScheme, totalMarks (number), knowledgeDeepDive (detailed explanation).`;

        const response = await aiClient.generateChatResponse([
            { role: 'system', content: 'You are an educational AI that generates high-quality exam questions in JSON format.' },
            { role: 'user', content: prompt }
        ]);

        // Parse AI response (strip markdown if present)
        const jsonString = response.replace(/```json|```/g, '').trim();
        const generatedQuestions = JSON.parse(jsonString);

        const savedQuestions = await Question.insertMany(
            generatedQuestions.map(q => ({
                ...q,
                teacherId: req.user._id,
                classId,
                subject,
                topic,
                difficulty,
                question: q.question || q.content || q.text || "",
                correctAnswer: q.answer !== undefined ? q.answer : (q.correctAnswer !== undefined ? q.correctAnswer : q.modelAnswer),
                knowledgeDeepDive: q.knowledgeDeepDive || q.explanation || q.modelAnswer || "No deep-dive available.",
                type: (type === 'multiple-choice') ? 'obj' : type,
                source: 'AI'
            }))
        );

        res.status(200).json({ success: true, questions: savedQuestions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'AI Generation failed: ' + error.message });
    }
};
