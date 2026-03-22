export const XP_REWARDS = {
    daily_login: 10,
    cbt_complete: 50,
    study_question: 5,
    syllabus_topic: 20,
    cbt_high_score: 30,
    streak_7_days: 100,
};

export const LEVELS = [
    { level: 1, name: 'Beginner', minXP: 0, icon: '🌱' },
    { level: 2, name: 'Learner', minXP: 200, icon: '📚' },
    { level: 3, name: 'Student', minXP: 500, icon: '✏️' },
    { level: 4, name: 'Scholar', minXP: 1000, icon: '🎓' },
    { level: 5, name: 'Expert', minXP: 2000, icon: '⭐' },
    { level: 6, name: 'Master', minXP: 3500, icon: '🏆' },
    { level: 7, name: 'Legend', minXP: 5000, icon: '👑' },
];

export const getLevelFromXP = (xp) => {
    let current = LEVELS[0];
    for (const lvl of LEVELS) {
        if (xp >= lvl.minXP) current = lvl;
    }
    const nextLevel = LEVELS.find(l => l.minXP > xp);
    const progress = nextLevel
        ? Math.round(((xp - current.minXP) / (nextLevel.minXP - current.minXP)) * 100)
        : 100;
    return { ...current, nextLevel, progress };
};

export const BADGES = [
    { id: 'first_cbt', name: 'First Test', description: 'Completed your first CBT', icon: '🎯' },
    { id: 'streak_3', name: '3-Day Streak', description: 'Logged in 3 days in a row', icon: '🔥' },
    { id: 'streak_7', name: 'Week Warrior', description: 'Logged in 7 days in a row', icon: '⚡' },
    { id: 'streak_30', name: 'Monthly Master', description: 'Logged in 30 days in a row', icon: '💎' },
    { id: 'top_10', name: 'Top 10', description: 'Reached top 10 on the leaderboard', icon: '🏅' },
    { id: 'century', name: 'Century', description: 'Answered 100 questions', icon: '💯' },
    { id: 'high_scorer', name: 'High Scorer', description: 'Scored 80%+ on a CBT', icon: '⭐' },
    { id: 'topic_explorer', name: 'Topic Explorer', description: 'Studied 10 different topics', icon: '🗺️' },
    { id: 'scholar', name: 'Scholar', description: 'Reached Scholar level', icon: '🎓' },
    { id: 'legend', name: 'Legend', description: 'Reached Legend level', icon: '👑' },
];

export const checkBadges = (progress) => {
    const earned = progress.badges.map(b => b.id);
    const newBadges = [];

    if (!earned.includes('first_cbt') && progress.totalCBTDone >= 1) {
        newBadges.push(BADGES.find(b => b.id === 'first_cbt'));
    }
    if (!earned.includes('streak_3') && progress.streak >= 3) {
        newBadges.push(BADGES.find(b => b.id === 'streak_3'));
    }
    if (!earned.includes('streak_7') && progress.streak >= 7) {
        newBadges.push(BADGES.find(b => b.id === 'streak_7'));
    }
    if (!earned.includes('streak_30') && progress.streak >= 30) {
        newBadges.push(BADGES.find(b => b.id === 'streak_30'));
    }
    if (!earned.includes('century') && progress.totalQuestionsAnswered >= 100) {
        newBadges.push(BADGES.find(b => b.id === 'century'));
    }
    if (!earned.includes('topic_explorer') && progress.totalTopicsStudied >= 10) {
        newBadges.push(BADGES.find(b => b.id === 'topic_explorer'));
    }
    if (!earned.includes('high_scorer') && (progress.highScoreCBTCount || 0) >= 1) {
        newBadges.push(BADGES.find(b => b.id === 'high_scorer'));
    }

    const levelInfo = getLevelFromXP(progress.xp);
    if (!earned.includes('scholar') && levelInfo.level >= 4) {
        newBadges.push(BADGES.find(b => b.id === 'scholar'));
    }
    if (!earned.includes('legend') && levelInfo.level >= 7) {
        newBadges.push(BADGES.find(b => b.id === 'legend'));
    }

    return newBadges.filter(Boolean);
};
