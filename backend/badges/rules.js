// Public metadata lives in /public/badges/manifest.json. Unlock rules stay server-side.
export const BADGE_IDS = Object.freeze([
    'first-blood', 'rooke-awakening', 'kestrel-conqueror', 'merlin-conqueror', 'on-the-rise', 'four-figures',
    'getting-dangerous', 'centurion', 'by-the-book', 'chaos-theory',
    'hat-trick', 'three-musketiers', 'the-hundred', 'podium', 'heir-apparent', 'sovereign',
]);
export function badgeMap(user) {
    const values = user.badges instanceof Map ? Object.fromEntries(user.badges) : user.badges || {};
    return Object.fromEntries(BADGE_IDS.filter(id => values[id]).map(id => [id, values[id]]));
}
export function equippedBadges(user) {
    const owned = badgeMap(user);
    return [...new Set(user.equippedBadges || [])].filter(id => owned[id]).slice(0, 3);
}
export function eligibleMilestones(user) {
    const progress = user.badgeProgress || {};
    const owned = badgeMap(user);
    return [
        ['first-blood', user.wins >= 1], ['on-the-rise', user.elo >= 600],
        ['four-figures', user.elo >= 1000], ['getting-dangerous', user.wins >= 10],
        ['centurion', user.wins >= 100], ['by-the-book', progress.classicWins >= 10],
        ['chaos-theory', progress.chaosWins >= 10], ['hat-trick', progress.winStreak >= 3],
        ['three-musketiers', owned['rooke-awakening'] && progress.classicWins >= 1 && progress.chaosWins >= 1],
    ].filter(([, eligible]) => eligible).map(([id]) => id);
}
export function grantMilestones(user, now = new Date()) {
    user.badges ||= {};
    const owned = badgeMap(user);
    const added = eligibleMilestones(user).filter(id => !owned[id]);
    for (const id of added) {
        if (user.badges instanceof Map) user.badges.set(id, now);
        else user.badges[id] = now;
    }
    return added;
}
export function recordBadgeResult(user, won, ruleset, now = new Date()) {
    user.badgeProgress ||= { classicWins: 0, chaosWins: 0, winStreak: 0 };
    const progress = user.badgeProgress;
    progress.winStreak = won ? (progress.winStreak || 0) + 1 : 0;
    if (won && ['normal', 'chaos'].includes(ruleset)) {
        const field = ruleset === 'normal' ? 'classicWins' : 'chaosWins';
        progress[field] = (progress[field] || 0) + 1;
    }
    return grantMilestones(user, now);
}
export function achievementState(user) {
    return {
        elo: user.elo, matches: user.matches, wins: user.wins, statsUpdatedAt: user.statsUpdatedAt || null, badges: badgeMap(user),
        badgeProgress: {
            classicWins: user.badgeProgress?.classicWins || 0,
            chaosWins: user.badgeProgress?.chaosWins || 0,
            winStreak: user.badgeProgress?.winStreak || 0,
        },
    };
}
// Pipeline assignments preserve the first unlock date under concurrent requests.
export function awardAssignments(ids, now) {
    return Object.fromEntries(ids.map(id => [`badges.${id}`, { $ifNull: [`$badges.${id}`, now] }]));
}
export function leaderboardAwards(users, entries, now) {
    const byId = new Map(users.map(user => [String(user._id), user]));
    return entries.flatMap(entry => {
        const owned = badgeMap(byId.get(entry.userId) || {});
        const ids = [['the-hundred', 100], ['podium', 3], ['heir-apparent', 2], ['sovereign', 1]]
            .filter(([id, threshold]) => entry.rank <= threshold && !owned[id]).map(([id]) => id);
        return ids.length ? [{ updateOne: { filter: { _id: entry.userId }, update: [{ $set: awardAssignments(ids, now) }] } }] : [];
    });
}
