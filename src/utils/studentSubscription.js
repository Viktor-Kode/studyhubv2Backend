import User from '../models/User.js';

/** Free-tier defaults after a paid plan ends */
export const FREE_TIER_LIMITS = {
  aiUsageLimit: 3,
  flashcardUsageLimit: 999999,
  noteUsageLimit: 3,
  quizUsageLimit: 3,
};


/**
 * If DB says "active" but subscriptionEnd is in the past, atomically downgrade to free limits.
 * Call from auth middleware so every protected request sees a consistent subscription state.
 */
export async function expireStaleActiveSubscription(user) {
  if (!user?._id) return user;
  if (user.subscriptionStatus !== 'active' || !user.subscriptionEnd) return user;
  if (new Date(user.subscriptionEnd) > new Date()) return user;

  const now = new Date();
  const updated = await User.findOneAndUpdate(
    {
      _id: user._id,
      subscriptionStatus: 'active',
      subscriptionEnd: { $lte: now },
    },
    {
      $set: {
        subscriptionStatus: 'expired',
        subscriptionPlan: null,
        aiUsageCount: 0,
        aiUsageLimit: FREE_TIER_LIMITS.aiUsageLimit,
        flashcardUsageCount: 0,
        flashcardUsageLimit: FREE_TIER_LIMITS.flashcardUsageLimit,
        noteUsageCount: 0,
        noteUsageLimit: FREE_TIER_LIMITS.noteUsageLimit,
        quizUsageCount: 0,
        quizUsageLimit: FREE_TIER_LIMITS.quizUsageLimit,
      },
    },
    { new: true },
  );

  if (updated) return updated;
  if (user.subscriptionStatus === 'active' && user.subscriptionEnd && new Date(user.subscriptionEnd) <= now) {
    return (await User.findById(user._id)) || user;
  }
  return user;
}

/** Paid library / storage tier: active status AND end date still in the future */
export function hasActivePaidStudentPlan(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  // Teachers with active teacher plan
  if (user.role === 'teacher') {
    return user.teacherPlan !== 'free' && 
           user.teacherPlanEnd && 
           new Date(user.teacherPlanEnd) > new Date();
  }

  // Students with active subscription
  if (user.subscriptionStatus !== 'active' || !user.subscriptionEnd) return false;
  return new Date(user.subscriptionEnd) > new Date();
}
