import UserActivity from '../models/UserActivity.js';

export async function logUserActivity({
    userId,
    type,
    title,
    subtitle = '',
    color = 'blue',
    metadata = {}
}) {
    if (!userId || !type || !title) return;
    try {
        await UserActivity.create({
            userId,
            type,
            title,
            subtitle,
            color,
            metadata
        });
    } catch (error) {
        // Never block core features because activity logging failed.
        console.warn('[activity] log failed:', error?.message || error);
    }
}
