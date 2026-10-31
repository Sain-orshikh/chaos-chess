import LegalMoveGenerate, { saveUndoInformation, unmakeMove } from "./legal_move";
import type { BasicMove, Board, Color } from "./types";
import { MATE_SCORE, pieceColor, pieceValue } from "./pieces";
import { makeMove } from "./apply_move";
import { isKingSafe } from "./king_safety";

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

/** alpha-beta minimax: depth counts player actions. Returns null when no legal move exists. */
export function Engine(board: Board, turn: Color, depth = 4, stats?: SearchStats): BasicMove | null {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError("Search depth must be a positive integer");
    const start = stats ? performance.now() : 0;
    if (stats) {
        Object.assign(stats, createSearchStats());
        stats.positionsVisited = 1; // Include the root; each explored move visits one more position.
    }

    let alpha = -Infinity;
    let beta = Infinity;

    function search(turn: Color, remainingDepth: number, alpha: number, beta: number): number {
        if (stats) stats.positionsVisited++;
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

        let bestScore = turn === "white" ? -Infinity : Infinity;
        for (let index = 0; index < moves.length; index++) {
            const move = moves[index];
            const score = scoreMove(move, turn, remainingDepth, alpha, beta);
            if (turn === "white") {
                bestScore = Math.max(bestScore, score);
                alpha = Math.max(alpha, bestScore);
            } else {
                bestScore = Math.min(bestScore, score);
                beta = Math.min(beta, bestScore);
            }

            if (alpha >= beta) {
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

    let bestMove: BasicMove | null = null;
    let bestScore = turn === "white" ? -Infinity : Infinity;
    const rootMoves = legalMoves(board, turn, stats);
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
    if (stats) stats.elapsedMs = performance.now() - start;
    return bestMove;
}
