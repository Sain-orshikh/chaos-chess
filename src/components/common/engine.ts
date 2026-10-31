import LegalMoveGenerate, { saveUndoInformation, unmakeMove } from "./legal_move";
import type { BasicMove, Board, Color } from "../utils/types";
import { MATE_SCORE, pieceColor, pieceValue, pieceDefinitions, pieceIds } from "../utils/pieces";
import { makeMove } from "./apply_move";
import { isKingSafe } from "../utils/king_safety";

export type SearchStats = {
    positionsVisited: number;
    positionsEvaluated: number;
    materialEvaluations: number;
    terminalPositions: number;
    movesExplored: number;
    generatedMoves: number;
    cutoffs: number;
    movesSkipped: number;
    elapsedMs: number;
    quiescenceNodes: number;
    quiescenceMoves: number;
    maxQuiescencePlyReached: number;
    quiescenceLimitHits: number;
};

export function createSearchStats(): SearchStats {
    return {
        positionsVisited: 0, positionsEvaluated: 0, materialEvaluations: 0,
        terminalPositions: 0, movesExplored: 0, generatedMoves: 0,
        cutoffs: 0, movesSkipped: 0, elapsedMs: 0,
        quiescenceNodes: 0, quiescenceMoves: 0, maxQuiescencePlyReached: 0, quiescenceLimitHits: 0,
    };
}

export const searchModes = ["minimax", "alpha-beta", "alpha-beta-ordered"] as const;
export type SearchMode = typeof searchModes[number];
export type SearchOptions = {
    mode?: SearchMode;
    maxTimeMs?: number;
    quiescence?: boolean;
    maxQuiescencePly?: number;
    maxCheckEvasionPly?: number;
    onProgress?: (stats: SearchStats) => void;
};

export const DEFAULT_SEARCH_TIME_MS = 5000;
export const DEFAULT_MAX_QUIESCENCE_PLY = 8;
export const DEFAULT_MAX_CHECK_EVASION_PLY = 8;

export class SearchLimitError extends Error {
    constructor(public readonly reason: "time" | "quiescence", message: string) { super(message); this.name = "SearchLimitError"; }
}
export class SearchTimeoutError extends SearchLimitError {
    constructor() { super("time", "Search time limit reached"); this.name = "SearchTimeoutError"; }
}
export class QuiescenceLimitError extends SearchLimitError {
    constructor() { super("quiescence", "Quiescence limit reached while in check"); this.name = "QuiescenceLimitError"; }
}

function legalMoves(board: Board, turn: Color, stats?: SearchStats): BasicMove[] {
    const moves: BasicMove[] = [];
    for (let square = 0; square < 64; square++) {
        if (pieceColor(board[square]) === turn) moves.push(...LegalMoveGenerate(board, square));
    }
    if (stats) stats.generatedMoves += moves.length;
    return moves;
}

function value(board: Board): number {
    return board.reduce((sum, piece) => sum + pieceValue(piece), 0);
}

/** Search priority, not a White-positive evaluation: both colors use positive magnitudes. */
export function movePriority(board: Board, move: BasicMove): number {
    if (move.kind === "rotate") return 0;
    const attacker = board[move.from];
    // A king has no material value, but must not rank as a free capture attacker.
    const attackerValue = Math.abs(attacker) === pieceIds.king
        ? pieceDefinitions.queen.value + pieceDefinitions.pawn.value
        : Math.abs(pieceValue(attacker));
    const victim = move.kind === "ch" ? board[(move.from + move.to) / 2]
        : move.kind === "c" ? board[move.to] : 0;
    const capturedValue = Math.abs(pieceValue(victim));
    const promotionBonus = move.promotion
        ? pieceDefinitions[move.promotion].value - pieceDefinitions.pawn.value
        : 0;
    return (capturedValue > 0 ? 10 * capturedValue - attackerValue : 0) + promotionBonus;
}

function orderMoves(board: Board, moves: BasicMove[], mode: SearchMode): BasicMove[] {
    if (mode !== "alpha-beta-ordered") return moves;
    // Score once, before making any move. Equal priorities retain generator order.
    return moves.map(move => ({ move, priority: movePriority(board, move) }))
        .sort((a, b) => b.priority - a.priority)
        .map(entry => entry.move);
}

/** Depth counts normal player actions; quiescence extends tactical leaves. Limits abort incomplete searches. */
export function Engine(board: Board, turn: Color, depth = 4, stats?: SearchStats, options: SearchOptions = {}): BasicMove | null {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError("Search depth must be a positive integer");
    const maxTimeMs = options.maxTimeMs ?? DEFAULT_SEARCH_TIME_MS;
    if (!Number.isFinite(maxTimeMs) || maxTimeMs <= 0) throw new RangeError("Search time limit must be positive");
    const maxQuiescencePly = options.maxQuiescencePly ?? DEFAULT_MAX_QUIESCENCE_PLY;
    if (!Number.isInteger(maxQuiescencePly) || maxQuiescencePly < 0 || maxQuiescencePly > 32) {
        throw new RangeError("Quiescence limit must be an integer from 0 to 32");
    }
    const maxCheckEvasionPly = options.maxCheckEvasionPly ?? DEFAULT_MAX_CHECK_EVASION_PLY;
    if (!Number.isInteger(maxCheckEvasionPly) || maxCheckEvasionPly < 0 || maxCheckEvasionPly > 16) {
        throw new RangeError("Check-evasion allowance must be an integer from 0 to 16");
    }
    const hardQuiescenceLimit = maxQuiescencePly + maxCheckEvasionPly;
    const mode = options.mode ?? "alpha-beta-ordered";
    if (!searchModes.includes(mode)) throw new RangeError("Unknown search mode");
    const start = performance.now();
    const deadline = start + maxTimeMs; // One deadline for normal search AND every quiescence branch.
    let checks = 0;
    let lastProgress = start;
    if (stats) { Object.assign(stats, createSearchStats()); stats.positionsVisited = 1; }

    function checkLimits(force = false) {
        if (!force && (++checks & 255) !== 0) return;
        const now = performance.now();
        if (stats) stats.elapsedMs = now - start;
        if (stats && options.onProgress && now - lastProgress >= 100) {
            options.onProgress({ ...stats });
            lastProgress = now;
        }
        if (now >= deadline) throw new SearchTimeoutError();
    }
    function evaluate(): number {
        if (stats) { stats.positionsEvaluated++; stats.materialEvaluations++; }
        return value(board);
    }
    function terminalScore(turn: Color): number {
        if (stats) { stats.positionsEvaluated++; stats.terminalPositions++; }
        return isKingSafe(board, turn) ? 0 : turn === "white" ? -MATE_SCORE : MATE_SCORE;
    }
    function cutoff(alpha: number, beta: number, skipped: number): boolean {
        if (mode === "minimax" || alpha < beta) return false;
        if (stats && skipped > 0) { stats.cutoffs++; stats.movesSkipped += skipped; }
        return true;
    }
    function afterMove(move: BasicMove, tactical: boolean, next: () => number): number {
        const undo = saveUndoInformation(board, move);
        makeMove(board, move);
        if (stats) { stats.movesExplored++; if (tactical) stats.quiescenceMoves++; }
        try { return next(); }
        finally { unmakeMove(board, move, undo); }
    }

    function quiescence(turn: Color, alpha: number, beta: number, ply: number, existingMoves?: BasicMove[]): number {
        // The normal depth-limit position was already counted and generated by search.
        if (stats) {
            if (!existingMoves) stats.positionsVisited++;
            stats.quiescenceNodes++;
            stats.maxQuiescencePlyReached = Math.max(stats.maxQuiescencePlyReached, ply);
        }
        checkLimits();
        const moves = existingMoves ?? legalMoves(board, turn, stats);
        if (moves.length === 0) return terminalScore(turn);
        const inCheck = !isKingSafe(board, turn);
        const candidates = inCheck ? moves : moves.filter(move =>
            move.kind === "c" || move.kind === "ch" || (move.kind !== "rotate" && move.promotion !== undefined));

        if (ply >= maxQuiescencePly) {
            if (inCheck || candidates.length > 0) { if (stats) stats.quiescenceLimitHits++; }
            // Once the capture budget is spent, finish any forced check responses first.
            if (!inCheck) return evaluate();
            // Counterchecks are possible. Bound that chain too, without inventing a static score.
            if (ply >= hardQuiescenceLimit) throw new QuiescenceLimitError();
        }
        let bestScore = turn === "white" ? -Infinity : Infinity;
        if (!inCheck) {
            bestScore = evaluate(); // Stand pat: captures are optional.
            if (turn === "white") alpha = Math.max(alpha, bestScore);
            else beta = Math.min(beta, bestScore);
            if (cutoff(alpha, beta, candidates.length)) return bestScore;
        }
        const orderedMoves = orderMoves(board, candidates, mode);
        const nextTurn = turn === "white" ? "black" : "white";
        for (let index = 0; index < orderedMoves.length; index++) {
            const score = afterMove(orderedMoves[index], true, () => quiescence(nextTurn, alpha, beta, ply + 1));
            if (turn === "white") { bestScore = Math.max(bestScore, score); alpha = Math.max(alpha, bestScore); }
            else { bestScore = Math.min(bestScore, score); beta = Math.min(beta, bestScore); }
            if (cutoff(alpha, beta, orderedMoves.length - index - 1)) break;
        }
        return bestScore;
    }

    function search(turn: Color, remainingDepth: number, alpha: number, beta: number): number {
        if (stats) stats.positionsVisited++;
        checkLimits();
        const moves = legalMoves(board, turn, stats);
        if (moves.length === 0) return terminalScore(turn);
        if (remainingDepth === 0) {
            return options.quiescence === false ? evaluate() : quiescence(turn, alpha, beta, 0, moves);
        }
        const orderedMoves = orderMoves(board, moves, mode);
        const nextTurn = turn === "white" ? "black" : "white";
        let bestScore = turn === "white" ? -Infinity : Infinity;
        for (let index = 0; index < orderedMoves.length; index++) {
            const score = afterMove(orderedMoves[index], false, () => search(nextTurn, remainingDepth - 1, alpha, beta));
            if (turn === "white") { bestScore = Math.max(bestScore, score); alpha = Math.max(alpha, bestScore); }
            else { bestScore = Math.min(bestScore, score); beta = Math.min(beta, bestScore); }
            if (cutoff(alpha, beta, orderedMoves.length - index - 1)) break;
        }
        return bestScore;
    }

    try {
        checkLimits(true);
        let alpha = -Infinity, beta = Infinity;
        let bestMove: BasicMove | null = null;
        let bestScore = turn === "white" ? -Infinity : Infinity;
        const rootMoves = orderMoves(board, legalMoves(board, turn, stats), mode);
        if (rootMoves.length === 0) terminalScore(turn);
        for (const move of rootMoves) {
            const score = afterMove(move, false, () => search(turn === "white" ? "black" : "white", depth - 1, alpha, beta));
            checkLimits(true);
            if (bestMove === null || (turn === "white" ? score > bestScore : score < bestScore)) {
                bestScore = score;
                bestMove = move;
            }
            if (turn === "white") alpha = Math.max(alpha, bestScore);
            else beta = Math.min(beta, bestScore);
        }
        return bestMove;
    } finally {
        if (stats) stats.elapsedMs = performance.now() - start;
    }
}
