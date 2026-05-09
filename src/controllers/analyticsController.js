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
        const { classId } = req.params;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher owns the class
        const classObj = await Class.findOne({ _id: classId, teacherId });
        if (!classObj) {
            return res.status(403).json({ success: false, message: 'Access denied to this class analytics' });
        }

        const analytics = await Analytics.findOne({ classId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getStudentPerformance = async (req, res) => {
    try {
        const { id } = req.params;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher has access to this student
        const hasAccess = await Class.exists({
            teacherId: teacherId,
            students: id
        });

        if (!hasAccess && String(teacherId) !== String(id)) {
            return res.status(403).json({ success: false, message: 'Access denied to this student performance' });
        }

        const submissions = await Submission.find({ studentId: id })
            .populate('examId', 'title')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, submissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getExamAnalytics = async (req, res) => {
    try {
        const { examId } = req.params;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher owns the exam through its class
        const exam = await Exam.findById(examId);
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

        const classObj = await Class.findOne({ _id: exam.classId, teacherId });
        if (!classObj) {
            return res.status(403).json({ success: false, message: 'Access denied to this exam analytics' });
        }

        const analytics = await Analytics.findOne({ examId });
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

        // Additional imports needed for new stats
        const UserStats = (await import('../models/UserStats.js')).default;
        const Question = (await import('../models/Question.js')).default;

        const [studyStats, flashStats, cbtStats, userStats, recentSessions, allCbtResults] = await Promise.all([
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
            ]),

            // User Stats (Streak, etc)
            UserStats.findOne({ userId: studentId }),

            // Recent Sessions
            CBTResult.find({ studentId })
                .sort({ takenAt: -1 })
                .limit(10)
                .select('subject accuracy takenAt totalQuestions')
                .lean(),
            
            // All CBT Results for Trend and Questions count
            CBTResult.find({ studentId })
                .sort({ takenAt: 1 })
                .select('accuracy takenAt totalQuestions')
                .lean()
        ]);

        // Calculate analytics from allCbtResults
        let overallAccuracy = 0;
        let questionCount = 0;
        let totalSessions = allCbtResults.length;
        
        if (allCbtResults.length > 0) {
            overallAccuracy = allCbtResults.reduce((acc, curr) => acc + (curr.accuracy || 0), 0) / allCbtResults.length;
            questionCount = allCbtResults.reduce((acc, curr) => acc + (curr.totalQuestions || 0), 0);
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const trendData = allCbtResults
            .filter(r => new Date(r.takenAt) >= thirtyDaysAgo)
            .map(r => ({ date: r.takenAt, score: r.accuracy }));

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
                cbtStats,
                // New Fields
                studyStreak: userStats ? userStats.studyStreak : 0,
                totalSessions,
                questionCount,
                overallAccuracy,
                recentSessions,
                trendData
            }
        });

    } catch (error) {
        console.error('Full analytics error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
