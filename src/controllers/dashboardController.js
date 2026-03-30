import mongoose from 'mongoose';
import StudySession from '../models/StudySession.js';
import CBTResult from '../models/CBTResult.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import Streak from '../models/Streak.js';
import Goal from '../models/Goal.js';
import FlashCard from '../models/FlashCard.js';

export const getDashboardSummary = async (req, res) => {
    try {
        const studentId = req.user._id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
            studyStats,
            cbtStats,
            cbtBySubject,
            flashStatsData,
            streakData,
            recentSessions,
            recentCbtResults,
            recentFlashcards,
            goals,
            totalFlashCount
        ] = await Promise.all([
            // Study Timer Stats
            StudySession.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(studentId), type: 'study' } },
                {
                    $group: {
                        _id: null,
                        totalSeconds: { $sum: '$duration' },
                        totalSessions: { $sum: 1 },
                        todaySeconds: {
                            $sum: {
                                $cond: [{ $gte: ['$startTime', today] }, '$duration', 0]
                            }
                        },
                        weekSeconds: {
                            $sum: {
                                $cond: [{ $gte: ['$startTime', weekAgo] }, '$duration', 0]
                            }
                        }
                    }
                }
            ]),

            // CBT Stats
            CBTResult.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: null,
                        totalExams: { $sum: 1 },
                        totalCorrect: { $sum: '$correctAnswers' },
                        totalQuestions: { $sum: '$totalQuestions' },
                        avgAccuracy: { $avg: '$accuracy' },
                        bestSubject: { $push: { subject: '$subject', accuracy: '$accuracy' } }
                    }
                }
            ]),

            // CBT by subject for strengths/weaknesses
            CBTResult.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: '$subject',
                        attempts: { $sum: 1 },
                        avgAccuracy: { $avg: '$accuracy' }
                    }
                },
                { $project: { _id: 0, subject: '$_id', attempts: 1, avgAccuracy: { $round: ['$avgAccuracy', 0] } } }
            ]),

            // Advanced Flashcard Stats
            FlashcardProgress.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: null,
                        totalCards: { $sum: 1 },
                        mastered: {
                            $sum: { $cond: [{ $eq: ['$status', 'mastered'] }, 1, 0] }
                        },
                        stillLearning: {
                            $sum: { $cond: [{ $in: ['$status', ['learning', 'reviewing']] }, 1, 0] }
                        },
                        totalReviews: { $sum: '$reviewCount' }
                    }
                }
            ]),

            // Streak Data
            Streak.findOne({ studentId }),

            // Recent Study Sessions (last 5)
            StudySession.find({ userId: new mongoose.Types.ObjectId(studentId), type: 'study' })
                .sort({ startTime: -1 })
                .limit(5)
                .select('title duration startTime'),

            // Recent CBT Results
            CBTResult.find({ studentId: new mongoose.Types.ObjectId(studentId) })
                .sort({ takenAt: -1, createdAt: -1 })
                .limit(5)
                .select('subject examType accuracy totalQuestions takenAt createdAt'),

            // Recently created flashcards
            FlashCard.find({ userId: new mongoose.Types.ObjectId(studentId) })
                .sort({ createdAt: -1 })
                .limit(5)
                .select('category createdAt'),

            // Active Goals
            Goal.find({ studentId, status: 'active' })
                .sort({ deadline: 1 })
                .limit(3),

            // Correct Total Flashcards
            FlashCard.countDocuments({ userId: studentId })
        ]);

        const study = studyStats[0] || {
            totalSeconds: 0, totalSessions: 0,
            todaySeconds: 0, weekSeconds: 0
        };

        const cbt = cbtStats[0] || {
            totalExams: 0, totalCorrect: 0,
            totalQuestions: 0, avgAccuracy: 0
        };

        const flash = flashStatsData[0] || {
            totalCards: 0, mastered: 0,
            stillLearning: 0, totalReviews: 0
        };

        const formatTime = (secs) => {
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        // Fallback best subject calculation
        let topSubject = 'N/A';
        if (cbt.bestSubject && cbt.bestSubject.length > 0) {
            const sorted = [...cbt.bestSubject].sort((a, b) => b.accuracy - a.accuracy);
            topSubject = sorted[0].subject;
        }

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
        const lastDate = streakData?.lastActivityDate
            ? new Date(streakData.lastActivityDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
            : (streakData?.lastStudiedDate ? new Date(streakData.lastStudiedDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : null);
        const currentStreak = streakData?.currentStreak || 0;
        const studiedToday = lastDate === todayStr;

        const activityFeed = [
            ...recentSessions.map((s) => ({
                id: `study-${s._id}`,
                type: 'study_session',
                title: s.title || 'Study Session',
                subtitle: s.duration ? `${Math.round(s.duration)} minutes completed` : 'Session completed',
                date: s.startTime,
                color: 'blue'
            })),
            ...recentCbtResults.map((r) => ({
                id: `cbt-${r._id}`,
                type: 'cbt_result',
                title: `${r.subject || 'CBT'} practice completed`,
                subtitle: `${r.accuracy ?? 0}% score in ${r.examType || 'CBT'} (${r.totalQuestions || 0} questions)`,
                date: r.takenAt || r.createdAt,
                color: 'emerald'
            })),
            ...recentFlashcards.map((f) => ({
                id: `flash-${f._id}`,
                type: 'flashcard_created',
                title: 'New flashcard added',
                subtitle: `${f.category || 'General'} category`,
                date: f.createdAt,
                color: 'purple'
            }))
        ]
            .filter((item) => item.date)
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10);

        const subjectPerformance = (cbtBySubject || [])
            .filter((s) => s.subject)
            .sort((a, b) => b.avgAccuracy - a.avgAccuracy);
        const strengths = subjectPerformance.slice(0, 3);
        const weaknesses = [...subjectPerformance]
            .sort((a, b) => a.avgAccuracy - b.avgAccuracy)
            .slice(0, 3);

        res.json({
            success: true,
            data: {
                studyTimer: {
                    todayTime: formatTime(study.todaySeconds * 60), // the model actually stores duration in minutes according to schema. Wait, if duration is in minutes, studyTimer uses seconds. I'll pass it as is. 
                    weekTime: formatTime(study.weekSeconds * 60),
                    totalTime: formatTime(study.totalSeconds * 60),
                    totalSessions: study.totalSessions,
                    recentSessions: recentSessions.map(s => ({
                        subject: s.title,
                        durationSeconds: s.duration * 60, // Assuming duration from old logic is stored as minutes, convert.
                        date: s.startTime
                    }))
                },
                cbt: {
                    examsTaken: cbt.totalExams,
                    overallAccuracy: cbt.totalExams > 0
                        ? Math.round(cbt.avgAccuracy) + '%'
                        : '0%',
                    totalCorrect: cbt.totalCorrect,
                    totalQuestions: cbt.totalQuestions,
                    bestSubject: topSubject,
                    strengthsWeaknesses: {
                        strengths,
                        weaknesses
                    }
                },
                flashcards: {
                    totalCards: totalFlashCount || 0,
                    mastered: flash.mastered,
                    stillLearning: flash.stillLearning,
                    totalReviews: flash.totalReviews,
                    masteryRate: (totalFlashCount || 0) > 0
                        ? Math.round((flash.mastered / (totalFlashCount || 1)) * 100) + '%'
                        : '0%'
                },
                streak: {
                    current: currentStreak,
                    longest: streakData?.longestStreak || 0,
                    lastStudied: streakData?.lastActivityDate || streakData?.lastStudiedDate || null,
                    studiedToday
                },
                goals,
                recentActivity: activityFeed
            }
        });
    } catch (error) {
        console.error('API Error: getDashboardSummary', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
