import crypto from 'node:crypto';
import StudyPath from '../models/StudyPath.js';
import { awardXP } from '../controllers/progressController.js';
import { incrementAIUsage } from '../middleware/usageMiddleware.js';
import { incrementStudyMapUsage } from '../controllers/studyPathController.js';

/**
 * Generates a cryptographically strong anonymous session ID.
 */
export function generateAnonymousSessionId() {
  return `anon_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Sanitizes an anonymous session ID.
 */
export function sanitizeAnonymousSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  const cleaned = id.trim();
  if (/^anon_[a-f0-9]{32}$/i.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Atomically transfers an anonymous study path to an authenticated user account.
 * Uses atomic findOneAndUpdate as the single-document gatekeeper, followed by durable
 * sequenced updates for XP and usage counters to provide crash-consistent idempotent recovery.
 */
export async function claimAnonymousStudyPath({ userId, anonymousSessionId, topicId }) {
  if (!userId || userId === 'anonymous-user') {
    throw new Error('Valid authenticated user ID is required to claim a study path.');
  }

  const cleanAnonId = sanitizeAnonymousSessionId(anonymousSessionId);
  if (!cleanAnonId) {
    throw new Error('A valid anonymousSessionId is required to claim an anonymous study path.');
  }

  // 1. Check for previously claimed map by this exact session (idempotent replay or conflict)
  const previouslyClaimed = await StudyPath.findOne({ claimedSessionId: cleanAnonId }).lean();
  if (previouslyClaimed) {
    // If owned by the same user: Idempotent replay!
    if (previouslyClaimed.userId === String(userId)) {
      // Re-check and complete any partially failed operations from a previous server crash
      if (!previouslyClaimed.claimState?.xpAwarded) {
        await awardXP(userId, 'ai_study_path').catch(() => {});
        await StudyPath.updateOne({ _id: previouslyClaimed._id }, { $set: { 'claimState.xpAwarded': true } }).catch(() => {});
      }
      if (!previouslyClaimed.claimState?.usageCounted) {
        await incrementAIUsage(userId).catch(() => {});
        await incrementStudyMapUsage(userId).catch(() => {});
        await StudyPath.updateOne({ _id: previouslyClaimed._id }, { $set: { 'claimState.usageCounted': true } }).catch(() => {});
      }
      return { studyPath: previouslyClaimed, alreadyClaimed: true };
    }
    // If owned by another user: Conflict!
    return { conflict: true, message: 'This anonymous study path has already been claimed by another account.' };
  }

  // 2. Atomically transition ownership from guest to authenticated user
  const claimed = await StudyPath.findOneAndUpdate(
    {
      anonymousSessionId: cleanAnonId,
      ...(topicId ? { topicId } : {}),
      $or: [
        { userId: 'anonymous-user' },
        { isAnonymousTrial: true }
      ]
    },
    {
      $set: {
        userId: String(userId),
        isAnonymousTrial: false,
        isActive: true,
        claimedSessionId: cleanAnonId,
        anonymousSessionId: null,
        'claimState.claimedAt': new Date(),
        'claimState.xpAwarded': false,
        'claimState.usageCounted': false
      }
    },
    { new: true }
  );

  if (!claimed) {
    return null;
  }

  // 3. Sequenced durable operations
  try {
    await awardXP(userId, 'ai_study_path');
    await StudyPath.updateOne({ _id: claimed._id }, { $set: { 'claimState.xpAwarded': true } });
  } catch (err) {
    console.warn('[claim] XP award failed, will recover on retry:', err.message);
  }

  try {
    await incrementAIUsage(userId);
    await incrementStudyMapUsage(userId);
    await StudyPath.updateOne({ _id: claimed._id }, { $set: { 'claimState.usageCounted': true } });
  } catch (err) {
    console.warn('[claim] Usage increment failed, will recover on retry:', err.message);
  }

  // Deactivate prior active paths
  await StudyPath.updateMany(
    { userId, isActive: true, _id: { $ne: claimed._id } },
    { $set: { isActive: false } }
  ).catch(() => {});

  console.log(`[anonymousSessionService] Atomically claimed study path "${claimed.topicId}" for user ${userId}`);

  return { studyPath: claimed, alreadyClaimed: false };
}
