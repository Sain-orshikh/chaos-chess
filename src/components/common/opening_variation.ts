import { MATE_SCORE } from "../utils/pieces";

export const OPENING_PLIES = 6;
export const ROOKE_OPENING_CUTOFF = 40; // Centipawns; one pawn is 100.

export function openingSeed(plyCount?: number, gameSeed = 0): number | undefined {
    if (plyCount === undefined || !Number.isSafeInteger(plyCount) || plyCount < 0 || plyCount >= OPENING_PLIES) return undefined;
    return (gameSeed ^ Math.imul(plyCount + 1, 0x9e3779b9)) >>> 0;
}

/** Scores are from the mover's perspective and must be exact, not alpha-beta bounds. */
export function chooseOpeningMove<T>(candidates: { move: T; score: number }[], cutoff: number, seed: number): T | null {
    if (!candidates.length) return null;
    const best = candidates.reduce((a, b) => b.score > a.score ? b : a);
    // Preserve forced mates (including the longest defense against a forced loss).
    if (Math.abs(best.score) >= MATE_SCORE - 1000) return best.move;
    const eligible = candidates.filter(candidate => best.score - candidate.score <= cutoff);
    const weight = (score: number) => cutoff + 1 - (best.score - score);
    let ticket = ((Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000
        * eligible.reduce((sum, candidate) => sum + weight(candidate.score), 0);
    for (const candidate of eligible) {
        ticket -= weight(candidate.score);
        if (ticket < 0) return candidate.move;
    }
    return best.move;
}
