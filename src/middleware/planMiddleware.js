import User from '../models/User.js';

export const checkCBTAccess = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const plan = user.plan || { type: 'free', testsAllowed: 1, testsUsed: 0, allSubjects: false, subjectsAllowed: ['english'] };

        // Check subject access (case insensitive)
        if (!plan.allSubjects) {
            const requestedSubject = (req.query.subject || req.body.subject)?.toLowerCase();
            if (requestedSubject) {
                const isAllowed = (plan.subjectsAllowed || []).some(s => s.toLowerCase() === requestedSubject);
                if (!isAllowed) {
                    return res.status(403).json({
                        error: 'Subject not in your plan',
                        message: `Upgrade to access ${requestedSubject || 'this subject'}`,
                        showUpgrade: true
                    });
                }
            }
        }

        // Check test quota
        if (plan.testsUsed >= plan.testsAllowed) {
            return res.status(403).json({
                error: 'Test limit reached',
                message: `You've used all ${plan.testsAllowed} tests in your plan`,
                showUpgrade: true
            });
        }

        next();
    } catch (error) {
        console.error('[Plan Middleware] Error:', error);
        res.status(500).json({ error: 'Internal server error checking access' });
    }
};

export const checkAIAccess = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const plan = user.plan || { aiExplanationsUsed: 0, aiExplanationsAllowed: 5 };

        if (plan.aiExplanationsUsed >= plan.aiExplanationsAllowed) {
            return res.status(403).json({
                error: 'AI explanation limit reached',
                message: 'Upgrade your plan for more AI explanations',
                showUpgrade: true
            });
        }
        next();
    } catch (error) {
        console.error('[Plan AI Middleware] Error:', error);
        res.status(500).json({ error: 'Internal server error checking AI access' });
    }
};
