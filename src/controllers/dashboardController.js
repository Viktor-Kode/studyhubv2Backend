import mongoose from 'mongoose';
import StudySession from '../models/StudySession.js';
import CBTResult from '../models/CBTResult.js';
import FlashcardProgress from '../models/FlashcardProgress.js';
import Streak from '../models/Streak.js';
import Goal from '../models/Goal.js';

export const getDashboardSummary = async (req, res) => {
    try {
        const studentId = req.user._id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
            studyStats,
            cbtStats,
            flashcardStats,
            streakData,
            recentSessions,
            goals
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

            // Flashcard Stats
            FlashcardProgress.aggregate([
                { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
                {
                    $group: {
                        _id: null,
                        totalMastered: { $sum: '$masteredCount' },
                        totalSeen: { $sum: '$seenCount' },
                        totalDecks: { $addToSet: '$deckId' }
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

            // Active Goals
            Goal.find({ studentId, status: 'active' })
                .sort({ deadline: 1 })
                .limit(3)
        ]);

        const study = studyStats[0] || {
            totalSeconds: 0, totalSessions: 0,
            todaySeconds: 0, weekSeconds: 0
        };

        const cbt = cbtStats[0] || {
            totalExams: 0, totalCorrect: 0,
            totalQuestions: 0, avgAccuracy: 0
        };

        const flash = flashcardStats[0] || {
            totalMastered: 0, totalSeen: 0, totalDecks: []
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

        let currentStreak = streakData?.currentStreak || 0;
        if (streakData && streakData.lastStudiedDate) {
            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
            const lastStudied = new Date(streakData.lastStudiedDate);
            lastStudied.setHours(0, 0, 0, 0);
            const diffDays = Math.round((todayDate - lastStudied) / (1000 * 60 * 60 * 24));
            // If they missed yesterday entirely, their streak breaks
            if (diffDays > 1) {
                currentStreak = 0;
            }
        }

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
                    bestSubject: topSubject
                },
                flashcards: {
                    cardsMastered: flash.totalMastered,
                    cardsSeen: flash.totalSeen,
                    decksStudied: flash.totalDecks.length || 0,
                    masteryRate: flash.totalSeen > 0
                        ? Math.round((flash.totalMastered / flash.totalSeen) * 100) + '%'
                        : '0%'
                },
                streak: {
                    current: currentStreak,
                    longest: streakData?.longestStreak || 0,
                    lastStudied: streakData?.lastStudiedDate || null
                },
                goals
            }
        });
    } catch (error) {
        console.error('API Error: getDashboardSummary', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
