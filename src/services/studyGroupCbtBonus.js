import StudyGroup from '../models/StudyGroup.js';

/**
 * +10 group leaderboard points when a member completes a CBT (optional studyGroupId on result payload).
 */
export async function awardStudyGroupCbtCompletion(firebaseUid, studyGroupId) {
  if (!firebaseUid || !studyGroupId) return;
  try {
    const group = await StudyGroup.findById(studyGroupId);
    if (!group || !group.members.some((m) => m.userId === firebaseUid)) return;
    await StudyGroup.findOneAndUpdate(
      { _id: studyGroupId, 'members.userId': firebaseUid },
      { $inc: { 'members.$.points': 10 }, $set: { lastActivity: new Date() } },
    );
  } catch (e) {
    console.warn('[studyGroupCbtBonus]', e.message);
  }
}
