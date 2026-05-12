import StudyPlan from '../models/StudyPlan.js';
import User from '../models/User.js';

const TASK_TYPES = ['cbt', 'note', 'timer', 'flashcard'];

const generateTasks = (planType, details, challenge, startDate, days = 14) => {
    const tasks = [];
    const subjects = planType === 'exam' ? details.subjects : [details.subject];
    const weakSubjects = details.weakSubjects || [];
    
    // Weight subjects: normal = 1, weak = 1.4
    const weightedSubjects = [];
    subjects.forEach(sub => {
        const weight = weakSubjects.includes(sub) ? 1.4 : 1.0;
        weightedSubjects.push({ name: sub, weight });
    });

    const getWeightedRandomSubject = () => {
        if (subjects.length === 0) return 'Subject';
        const totalWeight = weightedSubjects.reduce((sum, s) => sum + s.weight, 0);
        let random = Math.random() * totalWeight;
        for (const s of weightedSubjects) {
            if (random < s.weight) return s.name;
            random -= s.weight;
        }
        return subjects[0];
    };

    for (let i = 0; i < days; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + i);
        currentDate.setHours(0, 0, 0, 0);

        let dailyTasksCount = 4 + Math.floor(Math.random() * 2); // default 4-5
        
        // Challenge-based adjustments
        if (challenge === 'no_time') {
            dailyTasksCount = 2 + Math.floor(Math.random() * 2); // 2-3 tasks
        } else if (challenge === 'distraction') {
            dailyTasksCount = 3 + Math.floor(Math.random() * 2); // 3-4 tasks
        }

        let lastType = null;
        for (let j = 0; j < dailyTasksCount; j++) {
            let type;
            const rand = Math.random();

            // Weighted types based on challenge
            if (challenge === 'exam_anxiety') {
                type = rand < 0.6 ? 'cbt' : TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)];
            } else if (challenge === 'distraction' || challenge === 'procrastination') {
                type = rand < 0.5 ? 'timer' : TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)];
            } else {
                do {
                    type = TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)];
                } while (type === lastType);
            }
            lastType = type;

            const subject = getWeightedRandomSubject();
            let title = '';
            let link = '';

            switch (type) {
                case 'cbt':
                    title = `Practice 20 ${subject} questions`;
                    link = '/dashboard/cbt';
                    break;
                case 'note':
                    title = `Generate notes from ${subject}`;
                    link = '/dashboard/question-bank?tab=notes';
                    break;
                case 'timer':
                    const duration = challenge === 'procrastination' ? '20 min' : '30 min';
                    title = `${duration} focus session on ${subject}`;
                    link = '/dashboard/study-timer';
                    break;
                case 'flashcard':
                    title = `Review ${subject} flashcards`;
                    link = '/dashboard/library';
                    break;
            }

            tasks.push({
                date: currentDate,
                title,
                type,
                link,
                completed: false
            });
        }
    }
    return tasks;
};

export const createStudyPlan = async (req, res) => {
    try {
        const { planType, examDetails, generalDetails, studyChallenge } = req.body;
        const userId = req.user.firebaseUid || req.user._id;

        // Deactivate old plans
        await StudyPlan.updateMany({ userId, isActive: true }, { isActive: false });

        const tasks = generateTasks(
            planType, 
            planType === 'exam' ? examDetails : generalDetails, 
            studyChallenge,
            new Date()
        );

        const newPlan = await StudyPlan.create({
            userId,
            planType,
            studyChallenge,
            examDetails,
            generalDetails,
            tasks,
            streak: 0,
            isActive: true
        });

        res.status(201).json({ success: true, plan: newPlan });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getActivePlan = async (req, res) => {
    try {
        const userId = req.user.firebaseUid || req.user._id;
        const plan = await StudyPlan.findOne({ userId, isActive: true });
        
        if (!plan) {
            return res.status(200).json({ success: true, plan: null });
        }

        res.status(200).json({ success: true, plan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateTaskStatus = async (req, res) => {
    try {
        const { taskId, completed } = req.body;
        const userId = req.user.firebaseUid || req.user._id;

        const plan = await StudyPlan.findOne({ userId, isActive: true });
        if (!plan) return res.status(404).json({ success: false, message: 'No active plan found' });

        const taskIndex = plan.tasks.findIndex(t => t._id.toString() === taskId);
        if (taskIndex === -1) return res.status(404).json({ success: false, message: 'Task not found' });

        plan.tasks[taskIndex].completed = completed;
        plan.tasks[taskIndex].completedAt = completed ? new Date() : null;

        // Update streak logic
        if (completed) {
            const today = new Date().toISOString().split('T')[0];
            const lastActive = plan.lastActiveDate ? plan.lastActiveDate.toISOString().split('T')[0] : null;

            if (lastActive !== today) {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];

                if (lastActive === yesterdayStr) {
                    plan.streak += 1;
                } else if (!lastActive || lastActive < yesterdayStr) {
                    plan.streak = 1;
                }
                plan.lastActiveDate = new Date();
            }
        }

        await plan.save();
        res.status(200).json({ success: true, plan });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const resetPlan = async (req, res) => {
    try {
        const userId = req.user.firebaseUid || req.user._id;
        await StudyPlan.updateMany({ userId, isActive: true }, { isActive: false });
        res.status(200).json({ success: true, message: 'Plan reset successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
