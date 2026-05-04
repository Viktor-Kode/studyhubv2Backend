import Submission from '../models/Submission.js';
import Question from '../models/Question.js';
import Exam from '../models/Exam.js';
import Class from '../models/Class.js';
import aiClient from '../utils/aiClient.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';

export const getSubmission = async (req, res) => {
    try {
        const teacherId = req.user._id;
        const submission = await Submission.findById(req.params.id)
            .populate('studentId', 'name email')
            .populate('answers.questionId');

        if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

        // BOLA Check: Verify teacher has access to this submission via class
        const exam = await Exam.findById(submission.examId);
        const hasAccess = await Class.exists({ _id: exam?.classId, teacherId });

        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied to this submission' });
        }

        res.status(200).json({ success: true, submission });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const markSubmission = async (req, res) => {
    try {
        const { score, feedback } = req.body;
        const teacherId = req.user._id;

        const submission = await Submission.findById(req.params.id);
        if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

        // BOLA Check: Verify teacher access
        const exam = await Exam.findById(submission.examId);
        const hasAccess = await Class.exists({ _id: exam?.classId, teacherId });
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied to mark this submission' });
        }

        submission.score = score;
        submission.feedback = feedback;
        submission.status = 'marked';
        submission.markedAt = new Date();
        await submission.save();

        res.status(200).json({ success: true, submission });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const aiSuggestMark = async (req, res) => {
    try {
        const { questionId, studentAnswer, submissionId } = req.body;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher has access to the submission containing this question
        const submission = await Submission.findById(submissionId);
        const exam = await Exam.findById(submission?.examId);
        const hasAccess = await Class.exists({ _id: exam?.classId, teacherId });
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

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
        await incrementAIUsage(req.user._id);

        res.status(200).json({ success: true, suggestion });
    } catch (error) {
        res.status(500).json({ success: false, message: 'AI Marking failed: ' + error.message });
    }
};

export const overrideMark = async (req, res) => {
    // Logic same as markSubmission but can be used for final confirmation
    return markSubmission(req, res);
};
