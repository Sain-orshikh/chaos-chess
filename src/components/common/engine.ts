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
};

export function createSearchStats(): SearchStats {
    return {
        positionsVisited: 0, positionsEvaluated: 0, materialEvaluations: 0,
        terminalPositions: 0, movesExplored: 0, generatedMoves: 0,
        cutoffs: 0, movesSkipped: 0, elapsedMs: 0,
    };
}

export const searchModes = ["minimax", "alpha-beta", "alpha-beta-ordered"] as const;
export type SearchMode = typeof searchModes[number];
export type SearchOptions = {
    mode?: SearchMode;
    maxTimeMs?: number;
    onProgress?: (stats: SearchStats) => void;
};

export class SearchTimeoutError extends Error {
    constructor() { super("Search time limit reached"); this.name = "SearchTimeoutError"; }
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

/** Alpha-beta with move ordering by default. Depth counts player actions; null means no legal move. */
export function Engine(board: Board, turn: Color, depth = 4, stats?: SearchStats, options: SearchOptions = {}): BasicMove | null {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError("Search depth must be a positive integer");
    if (options.maxTimeMs !== undefined && (!Number.isFinite(options.maxTimeMs) || options.maxTimeMs <= 0)) {
        throw new RangeError("Search time limit must be positive");
    }
    const mode = options.mode ?? "alpha-beta-ordered";
    if (!searchModes.includes(mode)) throw new RangeError("Unknown search mode");
    const start = performance.now();
    const deadline = options.maxTimeMs === undefined ? Infinity : start + options.maxTimeMs;
    let checks = 0;
    let lastProgress = start;
    function checkLimits() {
        if ((++checks & 255) !== 0) return;
        const now = performance.now();
        if (stats) stats.elapsedMs = now - start;
        if (stats && options.onProgress && now - lastProgress >= 100) {
            options.onProgress({ ...stats });
            lastProgress = now;
        }
        if (now >= deadline) throw new SearchTimeoutError();
    }
    if (stats) {
        Object.assign(stats, createSearchStats());
        stats.positionsVisited = 1; // Include the root; each explored move visits one more position.
    }

    let alpha = -Infinity;
    let beta = Infinity;

    function search(turn: Color, remainingDepth: number, alpha: number, beta: number): number {
        if (stats) stats.positionsVisited++;
        checkLimits();
        const moves = legalMoves(board, turn, stats);
        // Detect mate even at the depth limit; both kings remain on the board.
        if (moves.length === 0) {
            if (stats) { stats.positionsEvaluated++; stats.terminalPositions++; }
            return isKingSafe(board, turn) ? 0 : turn === "white" ? -MATE_SCORE : MATE_SCORE;
        }
        if (remainingDepth === 0) {
            if (stats) { stats.positionsEvaluated++; stats.materialEvaluations++; }
            return value(board);
        }

        const orderedMoves = orderMoves(board, moves, mode);
        let bestScore = turn === "white" ? -Infinity : Infinity;
        for (let index = 0; index < orderedMoves.length; index++) {
            const move = orderedMoves[index];
            const score = scoreMove(move, turn, remainingDepth, alpha, beta);
            if (turn === "white") {
                bestScore = Math.max(bestScore, score);
                alpha = Math.max(alpha, bestScore);
            } else {
                bestScore = Math.min(bestScore, score);
                beta = Math.min(beta, bestScore);
            }

            if (mode !== "minimax" && alpha >= beta) {
                if (stats && index + 1 < moves.length) {
                    stats.cutoffs++;
                    stats.movesSkipped += moves.length - index - 1;
                }
                break;
            }
        }
        return bestScore;
    }

    function scoreMove(move: BasicMove, turn: Color, remainingDepth: number, alpha: number, beta: number): number {
        const undo = saveUndoInformation(board, move);
        makeMove(board, move);
        if (stats) stats.movesExplored++;
        try {
            return search(turn === "white" ? "black" : "white", remainingDepth - 1, alpha, beta);
        } finally {
            unmakeMove(board, move, undo);
        }
    }

    try {
        let bestMove: BasicMove | null = null;
        let bestScore = turn === "white" ? -Infinity : Infinity;
        const rootMoves = orderMoves(board, legalMoves(board, turn, stats), mode);
        if (stats && rootMoves.length === 0) {
            stats.positionsEvaluated++;
            stats.terminalPositions++;
        }
        for (const move of rootMoves) {
            const score = scoreMove(move, turn, depth, alpha, beta);
            if (bestMove === null || (turn === "white" ? score > bestScore : score < bestScore)) {
                bestScore = score;
                bestMove = move;
            }
            if (turn === "white") {
                alpha = Math.max(alpha, bestScore);
            } else {
                beta = Math.min(beta, bestScore);
            }
        }
        return bestMove;
    } finally {
        if (stats) stats.elapsedMs = performance.now() - start;
    }
}
