import Submission from '../models/Submission.js';
import Question from '../models/Question.js';
import aiClient from '../utils/aiClient.js';

export const getSubmission = async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id)
            .populate('studentId', 'name email')
            .populate('answers.questionId');
        if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
        res.status(200).json({ success: true, submission });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const markSubmission = async (req, res) => {
    try {
        const { score, feedback } = req.body;
        const submission = await Submission.findByIdAndUpdate(
            req.params.id,
            { score, feedback, status: 'marked', markedAt: new Date() },
            { new: true }
        );
        res.status(200).json({ success: true, submission });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const aiSuggestMark = async (req, res) => {
    try {
        const { questionId, studentAnswer } = req.body;
        const question = await Question.findById(questionId);

        if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

        const prompt = `Student answer: ${studentAnswer}
    Model answer: ${question.modelAnswer}
    Marking scheme: ${question.markingScheme || 'Compare for accuracy'}
    Suggest a score out of ${question.totalMarks} and list missing points. 
    Return JSON: { "suggestedScore": number, "missingPoints": [], "feedback": "" }`;

        const response = await aiClient.generateChatResponse([
            { role: 'system', content: 'You are an expert examiner providing fair marking suggestions.' },
            { role: 'user', content: prompt }
        ]);

        const jsonString = response.replace(/```json|```/g, '').trim();
        const suggestion = JSON.parse(jsonString);

        res.status(200).json({ success: true, suggestion });
    } catch (error) {
        res.status(500).json({ success: false, message: 'AI Marking failed: ' + error.message });
    }
};

export const overrideMark = async (req, res) => {
    // Logic same as markSubmission but can be used for final confirmation
    return markSubmission(req, res);
};
