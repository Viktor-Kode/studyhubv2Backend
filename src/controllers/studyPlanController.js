import StudyPlan from '../models/StudyPlan.js';
import User from '../models/User.js';

const TASK_TYPES = ['cbt', 'note', 'timer', 'flashcard'];

const generateTasks = (planType, details, challenges, startDate, days = 14) => {
    const tasks = [];
    const subjects = planType === 'exam' ? details.subjects : [details.subject];
    const weakSubjects = details.weakSubjects || [];
    
    const getWeightedRandomSubject = () => {
        if (subjects.length === 0) return 'Subject';
        const weighted = subjects.map(s => ({ name: s, w: weakSubjects.includes(s) ? 1.4 : 1.0 }));
        const total = weighted.reduce((sum, s) => sum + s.w, 0);
        let r = Math.random() * total;
        for (const s of weighted) {
            if (r < s.w) return s.name;
            r -= s.w;
        }
        return subjects[0];
    };

    const getTaskDetails = (type, subject, challenges) => {
        let title = '';
        let label = '';
        let tip = '';
        let link = '';

        const getTaskTip = (type, challenges) => {
            if (type === 'timer') {
                if (challenges.includes('procrastination')) return 'Starting is the hardest part. Just commit to the first 5 minutes!';
                if (challenges.includes('distraction')) return 'Put your phone in another room and use your generated notes to study.';
                return 'Focus purely on understanding. Use your AI-generated notes to guide this session.';
            }
            if (type === 'cbt') {
                if (challenges.includes('exam_anxiety')) return 'Don\'t worry about the score yet. Review the explanations for every wrong answer.';
                return 'Focus on speed and accuracy. Try to beat your previous time!';
            }
            if (type === 'note') {
                if (challenges.includes('no_plan')) return 'Once generated, read through and highlight the most important definitions.';
                return 'Use these notes as your primary study guide for your next Deep Work session.';
            }
            if (type === 'flashcard') {
                return 'Say the answers out loud before flipping. It helps with memory retention!';
            }
            return 'Stay consistent and focus on one concept at a time.';
        };

        const getTaskLabel = (type, challenges) => {
            if (challenges.includes('procrastination')) return '🔥 Procrastination Buster';
            if (challenges.includes('distraction')) return '📵 Deep Focus';
            if (challenges.includes('exam_anxiety')) return '🎯 Confidence Builder';
            if (challenges.includes('no_time')) return '⚡ High Impact';
            return '📚 General Study';
        };

        label = getTaskLabel(type, challenges);
        tip = getTaskTip(type, challenges);

        switch (type) {
            case 'cbt':
                const count = challenges.includes('procrastination') ? 10 : 20;
                title = `${subject}: Quick ${count}-Question Sprint`;
                link = '/dashboard/cbt';
                if (challenges.includes('exam_anxiety')) title = `${subject}: Mock Exam Simulation`;
                break;
            case 'note':
                title = `${subject}: Generate Summary Notes`;
                link = '/dashboard/question-bank?tab=notes';
                break;
            case 'timer':
                const mins = challenges.includes('procrastination') ? 15 : 45;
                title = `${subject}: ${mins}-Min Deep Work Session`;
                link = '/dashboard/study-timer';
                break;
            case 'flashcard':
                title = `${subject}: Flashcard Rapid Review`;
                link = '/dashboard/library';
                break;
        }

        return { title, label, tip, link };
    };

    for (let i = 0; i < days; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + i);
        currentDate.setHours(0, 0, 0, 0);

        let dailyTasksCount = 4 + Math.floor(Math.random() * 2);
        if (challenges.includes('no_time')) dailyTasksCount = 2 + Math.floor(Math.random() * 2);
        else if (challenges.includes('distraction')) dailyTasksCount = 3;

        let lastType = null;
        for (let j = 0; j < dailyTasksCount; j++) {
            let type;
            const rand = Math.random();

            if (challenges.includes('exam_anxiety') && rand < 0.5) type = 'cbt';
            else if ((challenges.includes('distraction') || challenges.includes('procrastination')) && rand < 0.4) type = 'timer';
            else {
                do { type = TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)]; } while (type === lastType);
            }
            lastType = type;

            const subject = getWeightedRandomSubject();
            const details = getTaskDetails(type, subject, challenges);

            tasks.push({
                date: currentDate,
                ...details,
                type,
                completed: false
            });
        }
    }
    return tasks;
};

export const createStudyPlan = async (req, res) => {
    try {
        const { planType, examDetails, generalDetails, studyChallenges } = req.body;
        const userId = req.user.firebaseUid || req.user._id;

        // Deactivate old plans
        await StudyPlan.updateMany({ userId, isActive: true }, { isActive: false });

        const tasks = generateTasks(
            planType, 
            planType === 'exam' ? examDetails : generalDetails, 
            studyChallenges || [],
            new Date()
        );

        const newPlan = await StudyPlan.create({
            userId,
            planType,
            studyChallenges,
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

export const autoCompleteTask = async (req, res) => {
    try {
        const { type } = req.body;
        const userId = req.user.firebaseUid || req.user._id;

        const plan = await StudyPlan.findOne({ userId, isActive: true });
        if (!plan) return res.status(200).json({ success: true, message: 'No active plan' });

        const today = new Date().toISOString().split('T')[0];
        
        // Find the first incomplete task of this type for today
        const taskIndex = plan.tasks.findIndex(t => {
            const taskDate = new Date(t.date).toISOString().split('T')[0];
            return taskDate === today && t.type === type && !t.completed;
        });

        if (taskIndex === -1) {
            return res.status(200).json({ success: true, message: 'No pending task of this type for today' });
        }

        plan.tasks[taskIndex].completed = true;
        plan.tasks[taskIndex].completedAt = new Date();

        // Update streak logic (reusing same logic as manual update)
        const lastActive = plan.lastActiveDate ? plan.lastActiveDate.toISOString().split('T')[0] : null;
        if (lastActive !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastActive === yesterdayStr) {
                plan.streak += 1;
            } else {
                plan.streak = 1;
            }
            plan.lastActiveDate = new Date();
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
