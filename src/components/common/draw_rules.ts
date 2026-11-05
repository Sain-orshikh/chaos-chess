import { pieceIds } from "../utils/pieces";
import type { BasicMove, Board, Ruleset } from "../utils/types";

export type AutomaticDrawReason = "insufficient-material" | "seventy-five-moves";
export const AUTOMATIC_DRAW_PLIES = 150;

/** Material-only dead positions; two knights are not automatically insufficient. */
export function hasInsufficientMaterial(board: Board, ruleset: Ruleset): boolean {
    let whiteKings = 0, blackKings = 0, bishops = 0, knights = 0;
    let bishopColor: number | undefined;
    for (let square = 0; square < 64; square++) {
        const piece = board[square], id = Math.abs(piece);
        if (!piece) continue;
        if (id === pieceIds.king) { if (piece > 0) whiteKings++; else blackKings++; continue; }
        if (id === pieceIds.knight) { knights++; continue; }
        if (id !== pieceIds.bishop) return false;
        bishops++;
        const color = (Math.floor(square / 8) + square % 8) % 2;
        if (bishopColor === undefined) bishopColor = color;
        else if (bishopColor !== color) return false;
    }
    if (whiteKings !== 1 || blackKings !== 1) return false;
    if (knights === 0) return true; // Bare kings, or only bishops confined to one square color.
    // A Chaos knight slides up to two squares and CAN mate with its king's help.
    return ruleset === "normal" && knights === 1 && bishops === 0;
}

export function automaticDrawReason(board: Board, ruleset: Ruleset, halfmoveClock: number): AutomaticDrawReason | null {
    if (hasInsufficientMaterial(board, ruleset)) return "insufficient-material";
    return halfmoveClock >= AUTOMATIC_DRAW_PLIES ? "seventy-five-moves" : null;
}

/** Count individual player actions. Every pawn move or capture resets the counter. */
export function nextHalfmoveClock(board: Board, move: BasicMove, clock: number): number {
    const reset = Math.abs(board[move.from]) === pieceIds.pawn || move.kind === "c" || move.kind === "ch" || move.kind === "en-passant";
    return reset ? 0 : clock + 1;
}
