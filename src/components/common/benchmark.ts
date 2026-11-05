import { Engine, createSearchStats, SearchLimitError, DEFAULT_MAX_QUIESCENCE_PLY, DEFAULT_MAX_CHECK_EVASION_PLY, searchModes } from "./engine";
import type { SearchMode, SearchStats } from "./engine";
import { legalMovesForPiece as LegalMoveGenerate } from "./rules";
import { parseBenchmarkFen } from "./benchmark_positions";
import { pieceColor } from "../utils/pieces";
import { createCastlingState, cloneStandardState } from "../utils/types";
import type { BasicMove, CastlingState, Ruleset, StandardState } from "../utils/types";

export type BenchmarkRequest = {
    castling?: CastlingState;
    ruleset?: Ruleset;
    standard?: StandardState;
    positionalScale?: number;
    fen: string; modes: SearchMode[]; maxDepth: number; repetitions: number; timeLimitMs: number; quiescence?: boolean; maxQuiescencePly?: number; maxCheckEvasionPly?: number;
};
export type BenchmarkResult = {
    mode: SearchMode; depth: number; status: "complete" | "timed-out" | "extension-limit" | "stopped";
    stats: SearchStats; medianMs: number | null; samplesMs: number[]; move: BasicMove | null;
};
export type BenchmarkMessage =
    | { type: "generation"; microseconds: number; legalMoves: number }
    | { type: "progress"; mode: SearchMode; depth: number; trial: number; stats: SearchStats }
    | { type: "result"; result: BenchmarkResult }
    | { type: "done" }
    | { type: "error"; message: string };

function median(values: number[]): number { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }

export function runBenchmark(request: BenchmarkRequest, emit: (message: BenchmarkMessage) => void): void {
    const position = parseBenchmarkFen(request.fen, request.ruleset);
    const { board, turn, halfmoveClock } = position;
    const standard = position.standard ? cloneStandardState(request.standard ?? position.standard) : undefined;
    const castling = { ...(request.castling ?? createCastlingState()) };
    if (!Number.isInteger(request.maxDepth) || request.maxDepth < 1 || request.maxDepth > 16) throw new Error("Choose a depth from 1 to 16.");
    if (![1, 3].includes(request.repetitions)) throw new Error("Choose one or three trials.");
    if (!Number.isFinite(request.timeLimitMs) || request.timeLimitMs < 100 || request.timeLimitMs > 10000) throw new Error("Invalid time limit.");
    if (!request.modes.length || request.modes.some(mode => !searchModes.includes(mode))) throw new Error("Choose an available search method.");
    const quiescence = request.quiescence ?? true;
    const maxQuiescencePly = request.maxQuiescencePly ?? DEFAULT_MAX_QUIESCENCE_PLY;
    const maxCheckEvasionPly = request.maxCheckEvasionPly ?? DEFAULT_MAX_CHECK_EVASION_PLY;
    if (!Number.isInteger(maxCheckEvasionPly) || maxCheckEvasionPly < 0 || maxCheckEvasionPly > 16) throw new Error("Invalid check-evasion allowance.");
    if (typeof quiescence !== "boolean" || !Number.isInteger(maxQuiescencePly) || maxQuiescencePly < 0 || maxQuiescencePly > 32) throw new Error("Invalid quiescence settings.");
    function generateAll() {
        let count = 0;
        for (let square = 0; square < 64; square++) {
            if (pieceColor(board[square]) === turn) count += LegalMoveGenerate(board, square, castling, standard).length;
        }
        return count;
    }
    for (let i = 0; i < 25; i++) generateAll();
    const samples: number[] = [];
    for (let trial = 0; trial < 3; trial++) {
        let iterations = 0;
        const start = performance.now();
        do { generateAll(); iterations++; } while (performance.now() - start < 30);
        samples.push((performance.now() - start) * 1000 / iterations);
    }
    emit({ type: "generation", microseconds: median(samples), legalMoves: generateAll() });
    for (const mode of [...new Set(request.modes)]) {
        Engine(board, turn, 1, undefined, { mode, quiescence: false, castling, standard, halfmoveClock, positionalScale: request.positionalScale }); // Untimed warmup.
        for (let depth = 1; depth <= request.maxDepth; depth++) {
            const samplesMs: number[] = [];
            let move: BasicMove | null = null;
            let lastStats = createSearchStats();
            let limitStatus: "timed-out" | "extension-limit" | null = null;
            for (let trial = 1; trial <= request.repetitions; trial++) {
                const stats = createSearchStats();
                emit({ type: "progress", mode, depth, trial, stats });
                try {
                    move = Engine(board, turn, depth, stats, {
                        mode, castling, standard, halfmoveClock, positionalScale: request.positionalScale, maxTimeMs: request.timeLimitMs, quiescence, maxQuiescencePly, maxCheckEvasionPly,
                        onProgress: snapshot => emit({ type: "progress", mode, depth, trial, stats: snapshot }),
                    });
                    samplesMs.push(stats.elapsedMs);
                } catch (error) {
                    if (!(error instanceof SearchLimitError)) throw error;
                    limitStatus = error.reason === "time" ? "timed-out" : "extension-limit";
                }
                lastStats = stats;
                if (limitStatus) break;
            }
            emit({ type: "result", result: {
                mode, depth, status: limitStatus ?? "complete", stats: lastStats,
                medianMs: limitStatus ? null : median(samplesMs), samplesMs, move: limitStatus ? null : move,
            } });
            if (limitStatus) break; // Continue with the next method; skip its deeper searches.
        }
    }
    emit({ type: "done" });
}
