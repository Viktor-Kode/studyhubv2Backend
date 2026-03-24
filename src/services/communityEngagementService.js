import CommunityNotification from '../models/CommunityNotification.js';
import User from '../models/User.js';
import { getStreak } from './streakService.js';

export const COMMUNITY_BADGE_CATALOG = [
  { id: 'first_post', name: 'First Post', icon: 'PenLine', description: 'Published your first community post' },
  { id: 'streak_30', name: 'Streak Master', icon: 'Flame', description: 'Maintained a 30-day study streak' },
  { id: 'top_answerer', name: 'Top Answerer', icon: 'Medal', description: 'Earned 5 best answers' },
  { id: 'popular_post', name: 'Popular', icon: 'ThumbsUp', description: 'A post reached 100 likes' },
];

export async function createCommunityNotification(payload) {
  const {
    recipientFirebaseUid,
    type,
    actorFirebaseUid = null,
    actorName = null,
    postId = null,
    commentId = null,
    meta = {},
  } = payload;
  if (!recipientFirebaseUid || recipientFirebaseUid === actorFirebaseUid) return null;
  return CommunityNotification.create({
    recipientFirebaseUid,
    type,
    actorFirebaseUid,
    actorName,
    postId,
    commentId,
    meta,
    read: false,
  });
}

export async function awardBadgeIfNew(userMongoDoc, badgeId) {
  if (!userMongoDoc || !badgeId) return false;
  userMongoDoc.communityBadges = userMongoDoc.communityBadges || [];
  if (userMongoDoc.communityBadges.includes(badgeId)) return false;
  userMongoDoc.communityBadges.push(badgeId);
  await userMongoDoc.save({ validateBeforeSave: false });
  if (userMongoDoc.firebaseUid) {
    await createCommunityNotification({
      recipientFirebaseUid: userMongoDoc.firebaseUid,
      type: 'badge',
      meta: { badgeId },
    });
  }
  return true;
}

export async function checkFirstPostBadge(user) {
  if ((user.postsCount || 0) >= 1) {
    await awardBadgeIfNew(user, 'first_post');
  }
}

export async function checkStreak30Badge(userMongoId) {
  const user = await User.findById(userMongoId);
  if (!user) return;
  const streakDoc = await getStreak(user._id);
  const n = streakDoc?.currentStreak || 0;
  if (n >= 30) await awardBadgeIfNew(user, 'streak_30');
}

export async function checkTopAnswererBadge(user) {
  if ((user.bestAnswersCount || 0) >= 5) {
    await awardBadgeIfNew(user, 'top_answerer');
  }
}

export async function checkPopularPostBadge(authorUser, likesCount) {
  if (likesCount >= 100) {
    await awardBadgeIfNew(authorUser, 'popular_post');
  }
}

/** @returns {string[]} firebase Uids */
export async function resolveMentionNamesInComment(content) {
  const re = /@([^\s@]{1,48})/g;
  const names = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const n = m[1].trim();
    if (n.length >= 2) names.add(n);
  }
  if (names.size === 0) return [];
  const uids = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const row = await User.findOne({
      firebaseUid: { $exists: true, $ne: null },
      name: new RegExp(`^${escaped}$`, 'i'),
    })
      .select('firebaseUid')
      .lean();
    if (row?.firebaseUid) uids.push(row.firebaseUid);
  }
  return uids;
}
