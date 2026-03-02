import Analytics from '../models/Analytics.js';
import Submission from '../models/Submission.js';
import Exam from '../models/Exam.js';
import Class from '../models/Class.js';
import StudySession from '../models/StudySession.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import CBTResult from '../models/CBTResult.js';
import mongoose from 'mongoose';

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

export const getFullAnalytics = async (req, res) => {
    try {
        const studentId = req.user._id;
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            last7Days.push(d);
        }

        const [studyStats, flashStats, cbtStats] = await Promise.all([
            // 7-day Study Sessions
            StudySession.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(studentId),
                        type: 'study',
                        startTime: { $gte: last7Days[0] }
                    }
                },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
                        minutes: { $sum: "$duration" }
                    }
                }
            ]),

            // Flashcard Status Breakdown
            FlashcardProgress.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 }
                    }
                }
            ]),

            // CBT Performance by Subject
            CBTResult.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: "$subject",
                        avgScore: { $avg: "$accuracy" },
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        // Format study data to ensure all 7 days are present
        const studyData = last7Days.map(date => {
            const dateStr = date.toISOString().split('T')[0];
            const found = studyStats.find(s => s._id === dateStr);
            return {
                day: date.toLocaleDateString('en-US', { weekday: 'short' }),
                minutes: found ? Math.round(found.minutes) : 0
            };
        });

        res.json({
            success: true,
            data: {
                studyChart: studyData,
                flashStats,
                cbtStats
            }
        });

    } catch (error) {
        console.error('Full analytics error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
