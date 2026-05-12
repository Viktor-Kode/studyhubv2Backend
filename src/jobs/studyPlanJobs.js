import cron from 'node-cron';
import StudyPlan from '../models/StudyPlan.js';
import User from '../models/User.js';
import { sendNotification } from '../services/notificationService.js';

const getTodayLagos = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

let registered = false;

export const registerStudyPlanJobs = () => {
    if (registered) return;
    registered = true;

    // 8:00 AM Lagos — Morning Reminder
    cron.schedule('0 8 * * *', async () => {
        try {
            const today = getTodayLagos();
            const activePlans = await StudyPlan.find({ isActive: true }).lean();

            for (const plan of activePlans) {
                const user = await User.findOne({ 
                    $or: [
                        { firebaseUid: plan.userId },
                        { _id: plan.userId }
                    ]
                }).select('name firebaseUid').lean();

                if (user?.firebaseUid) {
                    const firstName = user.name ? user.name.split(' ')[0] : 'there';
                    await sendNotification({
                        userId: user.firebaseUid,
                        type: 'study_plan_morning',
                        title: `☀️ Good morning, ${firstName}!`,
                        body: 'Your study plan is ready for today 📚',
                        icon: '📚',
                        link: '/dashboard/study-planner'
                    });
                }
            }
        } catch (err) {
            console.error('[StudyPlanJob] Morning reminder failed:', err.message);
        }
    }, { timezone: 'Africa/Lagos' });

    // 8:00 PM Lagos — Evening Reminder
    cron.schedule('0 20 * * *', async () => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            const activePlans = await StudyPlan.find({ isActive: true }).lean();

            for (const plan of activePlans) {
                const pendingTasks = plan.tasks.filter(t => {
                    const taskDate = new Date(t.date);
                    return taskDate >= todayStart && taskDate <= todayEnd && !t.completed;
                });

                if (pendingTasks.length > 0) {
                    const user = await User.findOne({ 
                        $or: [
                            { firebaseUid: plan.userId },
                            { _id: plan.userId }
                        ]
                    }).select('name firebaseUid').lean();

                    if (user?.firebaseUid) {
                        await sendNotification({
                            userId: user.firebaseUid,
                            type: 'study_plan_evening',
                            title: '⏰ Study Session Reminder',
                            body: `You have ${pendingTasks.length} tasks left today ⏰`,
                            icon: '⏰',
                            link: '/dashboard/study-planner'
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[StudyPlanJob] Evening reminder failed:', err.message);
        }
    }, { timezone: 'Africa/Lagos' });

    // 9:00 PM Lagos — Streak Alert
    cron.schedule('0 21 * * *', async () => {
        try {
            const today = getTodayLagos();
            const activePlans = await StudyPlan.find({ isActive: true, streak: { $gt: 0 } }).lean();

            for (const plan of activePlans) {
                const lastActive = plan.lastActiveDate ? new Date(plan.lastActiveDate).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : null;
                
                if (lastActive !== today) {
                    const user = await User.findOne({ 
                        $or: [
                            { firebaseUid: plan.userId },
                            { _id: plan.userId }
                        ]
                    }).select('name firebaseUid').lean();

                    if (user?.firebaseUid) {
                        await sendNotification({
                            userId: user.firebaseUid,
                            type: 'study_plan_streak',
                            title: '🔥 Keep the fire burning!',
                            body: "Don't break your streak! Study for 20 mins today 🔥",
                            icon: '🔥',
                            link: '/dashboard/study-planner'
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[StudyPlanJob] Streak alert failed:', err.message);
        }
    }, { timezone: 'Africa/Lagos' });

    console.log('📅 Study Plan jobs registered (8AM, 8PM, 9PM WAT)');
};
