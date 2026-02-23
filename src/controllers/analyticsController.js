import Analytics from '../models/Analytics.js';
import Submission from '../models/Submission.js';
import Exam from '../models/Exam.js';
import Class from '../models/Class.js';

export const getClassAnalytics = async (req, res) => {
    try {
        const analytics = await Analytics.findOne({ classId: req.params.classId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getStudentPerformance = async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.params.id })
            .populate('examId', 'title')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, submissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getExamAnalytics = async (req, res) => {
    try {
        const analytics = await Analytics.findOne({ examId: req.params.examId });
        res.status(200).json({ success: true, analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Internal function to trigger analytics computation
export const computeAnalytics = async (examId) => {
    try {
        const submissions = await Submission.find({ examId, status: 'marked' });
        if (submissions.length === 0) return;

        const exam = await Exam.findById(examId);
        if (!exam) return;

        const totalScore = submissions.reduce((sum, s) => sum + s.score, 0);
        const averageScore = totalScore / submissions.length;

        // Student breakdown
        const studentBreakdown = submissions.map(s => ({
            studentId: s.studentId,
            score: s.score,
            trend: 'stable' // Simplified
        }));

        await Analytics.findOneAndUpdate(
            { examId },
            {
                classId: exam.classId,
                examId,
                averageScore,
                studentBreakdown
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('Analytics computation failed:', error);
    }
};
