export const SEARCH_LEASE_MS = 45_000;
export function ratingRange(joinedAt, now) {
    const elapsed = Math.max(0, now - joinedAt);
    return elapsed >= 60_000 ? null : Math.min(800, 100 + 100 * Math.floor(elapsed / 5000));
}
export function compatible(a, b, now) {
    if (String(a._id) === String(b._id) || a.ruleset !== b.ruleset || a.timeMs !== b.timeMs || a.expiresAt <= now || b.expiresAt <= now) return false;
    if ([a, b].some(ticket => ticket.leases && !ticket.leases.some(lease => lease.until > now))) return false;
    const gap = Math.abs(a.rating - b.rating), ar = ratingRange(a.joinedAt, now), br = ratingRange(b.joinedAt, now);
    return (ar === null || gap <= ar) && (br === null || gap <= br);
}
export function chooseOpponent(ticket, candidates, now) {
    return candidates.filter(other => compatible(ticket, other, now)).sort((a, b) => a.joinedAt - b.joinedAt || Math.abs(a.rating - ticket.rating) - Math.abs(b.rating - ticket.rating) || String(a._id).localeCompare(String(b._id)))[0];
}
export function validQueue(ruleset, timeMs) {
    return ['normal', 'chaos'].includes(ruleset) && [300_000, 600_000].includes(timeMs);
}
