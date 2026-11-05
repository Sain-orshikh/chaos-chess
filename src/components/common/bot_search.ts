import { Engine, createSearchStats, SearchLimitError } from "./engine";
import type { SearchMode, SearchStats } from "./engine";
import { legalMovesForPiece as LegalMoveGenerate } from "./rules";
import { pieceColor } from "../utils/pieces";
import { createCastlingState, cloneStandardState } from "../utils/types";
import type { BasicMove, Board, Color, CastlingState, StandardState } from "../utils/types";
import { automaticDrawReason } from "./draw_rules";

export type BotSettings = {
    mode: SearchMode; maxDepth: number; maxTimeMs: number;
    quiescence: boolean; maxQuiescencePly: number; maxCheckEvasionPly: number;
};
export const defaultBotSettings: BotSettings = {
    mode: "alpha-beta-ordered", maxDepth: 16, maxTimeMs: 3000,
    quiescence: true, maxQuiescencePly: 8, maxCheckEvasionPly: 8,
};
export type BotRequest = { board: Board; turn: Color; settings: BotSettings; castling?: CastlingState; standard?: StandardState; halfmoveClock?: number; evaluationSeed?: number };
export type BotReport = {
    stats: SearchStats; completedDepth: number; searchingDepth: number; requestedDepth: number;
    generationMs: number; legalMoves: number;
};
export type BotResult = BotReport & {
    move: BasicMove | null; limit: "time" | "quiescence" | null; fallback: boolean;
};
export type BotMessage =
    | { type: "progress"; report: BotReport }
    | { type: "result"; result: BotResult }
    | { type: "error"; message: string };

/** One total deadline across iterative depths. Never replace a completed result with a partial one. */
export function searchBot(request: BotRequest, progress: (report: BotReport) => void = () => {}): BotResult {
    const { board, turn, settings } = request;
    const castling = { ...(request.castling ?? createCastlingState()) };
    const standard = request.standard ? cloneStandardState(request.standard) : undefined;
    if (!Number.isInteger(settings.maxDepth) || settings.maxDepth < 1 || settings.maxDepth > 16) throw new RangeError("Choose a depth from 1 to 16.");
    if (!Number.isFinite(settings.maxTimeMs) || settings.maxTimeMs < 100 || settings.maxTimeMs > 10000) throw new RangeError("Choose a time limit from 100 to 10000 ms.");
    const start = performance.now();
    const moves: BasicMove[] = [];
    const drawn = automaticDrawReason(board, standard ? "normal" : "chaos", request.halfmoveClock ?? 0);
    for (let square = 0; square < 64; square++) {
        if (!drawn && pieceColor(board[square]) === turn) moves.push(...LegalMoveGenerate(board, square, castling, standard));
    }
    const generationMs = performance.now() - start;
    const total = createSearchStats();
    let move: BasicMove | null = moves[0] ?? null;
    let completedDepth = 0, searchingDepth = 0;
    let limit: BotResult["limit"] = null;
    function report(current = createSearchStats()): BotReport {
        const stats = { ...total };
        for (const key of Object.keys(stats) as (keyof SearchStats)[]) {
            stats[key] = key === "maxQuiescencePlyReached" ? Math.max(total[key], current[key]) : total[key] + current[key];
        }
        stats.elapsedMs = performance.now() - start;
        return { stats, completedDepth, searchingDepth, requestedDepth: settings.maxDepth, generationMs, legalMoves: moves.length };
    }
    if (moves.length) for (let depth = 1; depth <= settings.maxDepth; depth++) {
        searchingDepth = depth;
        const remaining = settings.maxTimeMs - (performance.now() - start);
        if (remaining <= 0) { limit = "time"; break; }
        const current = createSearchStats();
        progress(report());
        try {
            const next = Engine(board, turn, depth, current, {
                ...settings, castling, standard, halfmoveClock: request.halfmoveClock, evaluationSeed: request.evaluationSeed, maxTimeMs: remaining, onProgress: snapshot => progress(report(snapshot)),
            });
            move = next;
            completedDepth = depth;
        } catch (error) {
            if (!(error instanceof SearchLimitError)) throw error;
            limit = error.reason;
        }
        Object.assign(total, report(current).stats);
        progress(report());
        if (limit) break;
    }
    return { ...report(), move, limit, fallback: moves.length > 0 && completedDepth === 0 };
}
