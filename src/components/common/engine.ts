import { saveUndoInformation, unmakeMove } from "./legal_move";
import { legalMovesForPiece as LegalMoveGenerate, kingSafe } from "./rules";
import { createCastlingState, cloneStandardState } from "../utils/types";
import type { BasicMove, Board, Color, CastlingState, StandardState, Ruleset } from "../utils/types";
import { MATE_SCORE, pieceColor, pieceValue, pieceDefinitions, pieceIds } from "../utils/pieces";
import { makeMove } from "./apply_move";
import { evaluateBoard, DEFAULT_CHECKMATE_EVAL_SCALE } from "../utils/checkmate_eval";
import { createPieceSquareTables, defaultPieceSquareTables } from "../utils/positional_eval";
import { zobrist_hash } from "../utils/hash";
import { createTranspositionTable } from "../utils/transpose_table";
import { automaticDrawReason, nextHalfmoveClock } from "./draw_rules";
import { chooseOpeningMove } from "./opening_variation";

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
    castling?: CastlingState;
    standard?: StandardState;
    halfmoveClock?: number;
    mode?: SearchMode;
    maxTimeMs?: number;
    quiescence?: boolean;
    maxQuiescencePly?: number;
    maxCheckEvasionPly?: number;
    checkmateEvalScale?: number;
    positionalScale?: number;
    evaluationSeed?: number;
    openingVariation?: { cutoff: number; seed: number };
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

function legalMoves(board: Board, turn: Color, castling: CastlingState, stats?: SearchStats, standard?: StandardState): BasicMove[] {
    const moves: BasicMove[] = [];
    for (let square = 0; square < 64; square++) {
        if (pieceColor(board[square]) === turn) moves.push(...LegalMoveGenerate(board, square, castling, standard));
    }
    if (stats) stats.generatedMoves += moves.length;
    return moves;
}

/** Search priority, not a White-positive evaluation: both colors use positive magnitudes. */
export function movePriority(board: Board, move: BasicMove, ruleset: Ruleset = "chaos"): number {
    if (move.kind === "rotate" || move.kind === "castle") return 0;
    const attacker = board[move.from];
    // A king has no material value, but must not rank as a free capture attacker.
    const attackerValue = Math.abs(attacker) === pieceIds.king
        ? Math.abs(pieceValue(pieceIds.queen, ruleset)) + Math.abs(pieceValue(pieceIds.pawn, ruleset))
        : Math.abs(pieceValue(attacker, ruleset));
    const victim = move.kind === "en-passant" ? board[move.capturedSquare] : move.kind === "ch" ? board[(move.from + move.to) / 2]
        : move.kind === "c" ? board[move.to] : 0;
    const capturedValue = Math.abs(pieceValue(victim, ruleset));
    const promotionBonus = move.promotion
        ? Math.abs(pieceValue(pieceDefinitions[move.promotion].id, ruleset)) - Math.abs(pieceValue(pieceIds.pawn, ruleset))
        : 0;
    return (capturedValue > 0 ? 10 * capturedValue - attackerValue : 0) + promotionBonus;
}

function orderMoves(board: Board, moves: BasicMove[], mode: SearchMode, ruleset: Ruleset): BasicMove[] {
    if (mode !== "alpha-beta-ordered") return moves;
    // Score once, before making any move. Equal priorities retain generator order.
    return moves.map(move => ({ move, priority: movePriority(board, move, ruleset) }))
        .sort((a, b) => b.priority - a.priority)
        .map(entry => entry.move);
}

/** Depth counts normal player actions; quiescence extends tactical leaves. Limits abort incomplete searches. */
export function Engine(board: Board, turn: Color, depth = 4, stats?: SearchStats, options: SearchOptions = {}): BasicMove | null {
    const castling = { ...(options.castling ?? createCastlingState()) };
    const standard = options.standard ? cloneStandardState(options.standard) : undefined;
    const ruleset = standard ? "normal" : "chaos";
    let halfmoveClock = options.halfmoveClock ?? 0;
    if (!Number.isSafeInteger(halfmoveClock) || halfmoveClock < 0) throw new RangeError("Invalid halfmove clock");
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError("Search depth must be a positive integer");
    const checkmateEvalScale = options.checkmateEvalScale ?? DEFAULT_CHECKMATE_EVAL_SCALE;
    if (!Number.isFinite(checkmateEvalScale) || checkmateEvalScale < 0 || checkmateEvalScale > 100) throw new RangeError("Checkmate evaluation scale must be from 0 to 100");
    const positionalScale = options.positionalScale ?? 1;
    if (!Number.isFinite(positionalScale) || positionalScale < 0 || positionalScale > 2) throw new RangeError("Positional scale must be from 0 to 2");
    const evaluationSeed = options.evaluationSeed ?? 0;
    if (!Number.isInteger(evaluationSeed) || evaluationSeed < 0 || evaluationSeed > 0xffffffff) throw new RangeError("Evaluation seed must be an unsigned 32-bit integer");
    const tables = evaluationSeed === 0 ? defaultPieceSquareTables : createPieceSquareTables(evaluationSeed);
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
    const table = createTranspositionTable()


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
        return evaluateBoard(board, checkmateEvalScale, positionalScale, tables, ruleset);
    }
    function terminalScore(turn: Color, plyFromRoot: number): number {
        if (stats) { stats.positionsEvaluated++; stats.terminalPositions++; }
        return kingSafe(board, turn, standard) ? 0 : turn === "white" ? -MATE_SCORE + plyFromRoot : MATE_SCORE - plyFromRoot;
    }
    function drawScore(): number {
        if (stats) { stats.positionsEvaluated++; stats.terminalPositions++; }
        return 0;
    }
    function cutoff(alpha: number, beta: number, skipped: number): boolean {
        if (mode === "minimax" || alpha < beta) return false;
        if (stats && skipped > 0) { stats.cutoffs++; stats.movesSkipped += skipped; }
        return true;
    }
    function afterMove(move: BasicMove, tactical: boolean, next: () => number): number {
        const undo = saveUndoInformation(board, move, castling, standard);
        const previousClock = halfmoveClock;
        const nextClock = nextHalfmoveClock(board, move, halfmoveClock);
        makeMove(board, move, castling, standard);
        halfmoveClock = nextClock;
        if (stats) { stats.movesExplored++; if (tactical) stats.quiescenceMoves++; }
        try { return next(); }
        finally { unmakeMove(board, move, undo, castling, standard); halfmoveClock = previousClock; }
    }

    function quiescence(turn: Color, alpha: number, beta: number, ply: number, existingMoves?: BasicMove[]): number {
        // The normal depth-limit position was already counted and generated by search.
        if (stats) {
            if (!existingMoves) stats.positionsVisited++;
            stats.quiescenceNodes++;
            stats.maxQuiescencePlyReached = Math.max(stats.maxQuiescencePlyReached, ply);
        }
        checkLimits();
        const moves = existingMoves ?? legalMoves(board, turn, castling, stats, standard);
        if (moves.length === 0) return terminalScore(turn, depth + ply);
        if (automaticDrawReason(board, ruleset, halfmoveClock)) return drawScore();
        const inCheck = !kingSafe(board, turn, standard);
        const candidates = inCheck ? moves : moves.filter(move =>
            move.kind === "c" || move.kind === "ch" || move.kind === "en-passant" || (move.kind !== "rotate" && move.promotion !== undefined));

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
        const orderedMoves = orderMoves(board, candidates, mode, ruleset);
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

        const alphaStart = alpha
        const betaStart = beta

        const hash = zobrist_hash(board, castling.white, castling.black, turn, standard, halfmoveClock)
        const entry = table.lookup(hash)
        if (
            entry !== undefined &&
            entry.depth === remainingDepth
        ) {
            if (entry.bound === "exact"){
                return entry.score
            }
            else if(entry.bound === "lower"){
                alpha = Math.max(alpha, entry.score)
            } 
            else{
                beta = Math.min(beta, entry.score)
            }
            if (alpha >= beta) return entry.score
        }
        let bestMoveForThisPosition = null
            const moves = legalMoves(board, turn, castling, stats, standard);
            if (moves.length === 0) return terminalScore(turn, depth - remainingDepth);
            if (automaticDrawReason(board, ruleset, halfmoveClock)) return drawScore();
            if (remainingDepth === 0) {
                return options.quiescence === false ? evaluate() : quiescence(turn, alpha, beta, 0, moves);
            }
            const orderedMoves = orderMoves(board, moves, mode, ruleset);
            const nextTurn = turn === "white" ? "black" : "white";
            let bestScore = turn === "white" ? -Infinity : Infinity;
            for (let index = 0; index < orderedMoves.length; index++) {
                const score = afterMove(orderedMoves[index], false, () => search(nextTurn, remainingDepth - 1, alpha, beta));
                if (turn === "white") { 
                    if (score > bestScore){
                        bestScore = score
                        bestMoveForThisPosition = orderedMoves[index]
                    }
                    alpha = Math.max(alpha, bestScore); 
                }
                else { 
                    if (score < bestScore){
                        bestScore = score
                        bestMoveForThisPosition = orderedMoves[index]
                    }
                    beta = Math.min(beta, bestScore); 
                }
                if (cutoff(alpha, beta, orderedMoves.length - index - 1)) break;
            }

            const bound =
                bestScore <= alphaStart ? "upper" :
                bestScore >= betaStart  ? "lower" :
                "exact";

            table.store({
                hash,
                depth: remainingDepth,
                score: bestScore,
                bound: bound,
                bestMove: bestMoveForThisPosition,
            });

        return bestScore;
    }

    try {
        checkLimits(true);
        let alpha = -Infinity, beta = Infinity;
        let bestMove: BasicMove | null = null;
        let bestScore = turn === "white" ? -Infinity : Infinity;
        const candidates: { move: BasicMove; score: number }[] = [];
        const rootMoves = orderMoves(board, legalMoves(board, turn, castling, stats, standard), mode, ruleset);
        if (rootMoves.length === 0) terminalScore(turn, 0);
        else if (automaticDrawReason(board, ruleset, halfmoveClock)) { drawScore(); return null; }
        for (const move of rootMoves) {
            // Independent full windows give exact candidate scores; fail-low bounds
            // from the usual root window cannot safely be used for random selection.
            const score = afterMove(move, false, () => search(turn === "white" ? "black" : "white", depth - 1,
                options.openingVariation ? -Infinity : alpha, options.openingVariation ? Infinity : beta));
            checkLimits(true);
            if (options.openingVariation) candidates.push({ move, score: turn === "white" ? score : -score });
            if (bestMove === null || (turn === "white" ? score > bestScore : score < bestScore)) {
                bestScore = score;
                bestMove = move;
            }
            if (turn === "white") alpha = Math.max(alpha, bestScore);
            else beta = Math.min(beta, bestScore);
        }
        return options.openingVariation
            ? chooseOpeningMove(candidates, options.openingVariation.cutoff, options.openingVariation.seed)
            : bestMove;
    } finally {
        if (stats) stats.elapsedMs = performance.now() - start;
    }
}
