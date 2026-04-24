import PaywallEvent from '../models/PaywallEvent.js';

/**
 * Logs a paywall event to the database.
 * @param {Object} params
 * @param {string} params.userId - The ID of the user.
 * @param {string} params.userEmail - The email of the user.
 * @param {string} params.action - The type of limit hit (e.g., 'AI_LIMIT').
 * @param {Object} [params.context] - Additional context like subject, examType, etc.
 */
export const logPaywallEvent = async ({ userId, userEmail, action, context = {} }) => {
    try {
        await PaywallEvent.create({
            userId,
            userEmail,
            action,
            context,
            timestamp: new Date()
        });
        console.log(`[Paywall] Event logged for ${userEmail}: ${action}`);
    } catch (error) {
        console.error('[Paywall Logger] Error logging event:', error);
    }
};
