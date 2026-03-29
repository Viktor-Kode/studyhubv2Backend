import User from '../models/User.js';

const FIELD_BY_ACTION = {
    cbt: 'progress.hasCompletedCBT',
    ai_tutor: 'progress.hasUsedAITutor',
    library: 'progress.hasUploadedLibrary',
    community: 'progress.hasJoinedCommunity',
    flashcard: 'progress.hasCreatedFlashcard',
};

/**
 * Sets a server-side onboarding checklist flag for the Mongo user.
 * @param {import('mongoose').Types.ObjectId|string} mongoUserId
 * @param {'cbt'|'ai_tutor'|'library'|'community'|'flashcard'} action
 */
export async function markUserProgress(mongoUserId, action) {
    const path = FIELD_BY_ACTION[action];
    if (!path || !mongoUserId) return;
    try {
        await User.findByIdAndUpdate(
            mongoUserId,
            { $set: { [path]: true } },
        );
    } catch (err) {
        console.warn('[markUserProgress]', action, err?.message);
    }
}
