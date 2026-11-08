export type LeaderboardEntry = { userId: string; username: string; name: string; elo: number; matches: number; wins: number; rank: number; profileImg?: string; equippedBadges?: string[] };
export type LeaderboardSnapshot = { generatedAt: number; entries: LeaderboardEntry[] };

let saved: { value: LeaderboardSnapshot; freshUntil: number } | undefined;
let pending: Promise<LeaderboardSnapshot> | undefined;
let retryAt = 0;
let failures = 0;

export function retainedLeaderboard() { return saved?.value; }

export function readLeaderboard(): Promise<LeaderboardSnapshot> {
    if (pending) return pending;
    if (Date.now() < retryAt) return Promise.reject(new Error("Standings are unavailable. Please try again in a minute."));
    if (saved && Date.now() < saved.freshUntil) return Promise.resolve(saved.value);
    pending = (async () => {
        try {
            const response = await fetch("/api/leaderboard", { credentials: "omit", signal: AbortSignal.timeout(12_000) });
            if (!response.ok) {
                const seconds = Number(response.headers.get("Retry-After"));
                if (Number.isFinite(seconds) && seconds > 0) retryAt = Date.now() + Math.min(seconds, 300) * 1000;
                throw new Error("Standings are temporarily unavailable. Please try again shortly.");
            }
            const value: LeaderboardSnapshot = await response.json();
            if (!Number.isFinite(value.generatedAt) || !Array.isArray(value.entries) || value.entries.length > 100 ||
                value.entries.some(entry => typeof entry.userId !== "string" || typeof entry.name !== "string" ||
                    typeof entry.username !== "string" || ![entry.elo, entry.matches, entry.wins, entry.rank].every(Number.isSafeInteger) ||
                    (entry.profileImg !== undefined && (typeof entry.profileImg !== 'string' || entry.profileImg.length > 512)) ||
                    (entry.equippedBadges !== undefined && (!Array.isArray(entry.equippedBadges) || entry.equippedBadges.length > 3 || entry.equippedBadges.some(id => typeof id !== 'string'))))) {
                throw new Error("Could not read the standings. Please try again shortly.");
            }
            // A nearly expired server snapshot must not gain five more minutes
            // just because this tab downloaded it late in its lifetime.
            const fetchedAt = Date.now();
            saved = { value, freshUntil: Math.min(fetchedAt + 300_000, Math.max(fetchedAt + 10_000, value.generatedAt + 300_000)) };
            failures = 0; retryAt = 0;
            return value;
        } catch (error) {
            failures++;
            retryAt = Math.max(retryAt, Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(failures - 1, 5)));
            throw error;
        } finally { pending = undefined; }
    })();
    return pending;
}
