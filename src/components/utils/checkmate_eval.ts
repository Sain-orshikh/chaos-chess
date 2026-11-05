import type { Board, Ruleset } from "./types";
import { pieceIds, pieceValue, pieceDefinitions } from "./pieces";
import { boundedPositionBonus, defaultPieceSquareTables, openingWeight } from "./positional_eval";
import type { PieceSquareTables } from "./positional_eval";

// Raw king-driving strength; the complete positional correction is bounded below one pawn.
export const DEFAULT_CHECKMATE_EVAL_SCALE = 5;
export const ENDGAME_PIECE_THRESHOLD = 8;

/** Count the defender's non-king pieces: 8+ = 0, 4 = 0.5, bare king = 1. */
export function endgameWeight(enemyPieceCount: number): number {
    return Math.max(0, Math.min(1, 1 - enemyPieceCount / ENDGAME_PIECE_THRESHOLD));
}

export function ForceKingToCheckmateEval(myKing: number, enemyKing: number, endgameWeight: number, scale = DEFAULT_CHECKMATE_EVAL_SCALE){
    let evaluation = 0
    const enemyKingRow = Math.floor(enemyKing / 8)
    const enemyKingCol = enemyKing % 8
    const myKingRow = Math.floor(myKing / 8)
    const myKingCol = myKing % 8
    evaluation += 14 - (Math.abs(myKingCol - enemyKingCol) + Math.abs(myKingRow - enemyKingRow))
    //dist form center
    evaluation += Math.max(3 - enemyKingRow, enemyKingRow - 4) + Math.max(3 - enemyKingCol, enemyKingCol - 4)

    return evaluation * scale * endgameWeight;
}

/** White-positive static score. This guides king placement; it does not detect mate. */
export function evaluateBoard(board: Board, scale = DEFAULT_CHECKMATE_EVAL_SCALE, positionalScale = 1, tables: PieceSquareTables = defaultPieceSquareTables, ruleset: Ruleset = "chaos"): number {
    let material = 0, whiteKing = -1, blackKing = -1;
    let whitePieces = 0, blackPieces = 0;
    let whiteHasNonPawn = false, blackHasNonPawn = false;
    let openingScore = 0, endgameScore = 0, nonPawnMaterial = 0;
    for (let square = 0; square < board.length; square++) {
        const piece = board[square];
        if (piece === 0) continue;
        const id = Math.abs(piece), sign = piece > 0 ? 1 : -1;
        const tableSquare = piece > 0 ? square : (7 - Math.floor(square / 8)) * 8 + square % 8;
        if (positionalScale !== 0) {
            openingScore += sign * tables[id].opening[tableSquare];
            endgameScore += sign * tables[id].endgame[tableSquare];
        }
        if (piece === pieceIds.king) { whiteKing = square; continue; }
        if (piece === -pieceIds.king) { blackKing = square; continue; }
        const value = pieceValue(piece, ruleset);
        material += value;
        if (id !== pieceIds.pawn) nonPawnMaterial += Math.abs(value);
        if (piece > 0) { whitePieces++; if (piece !== pieceIds.pawn) whiteHasNonPawn = true; }
        else { blackPieces++; if (piece !== -pieceIds.pawn) blackHasNonPawn = true; }
    }
    const early = openingWeight(nonPawnMaterial, ruleset);
    const positional = positionalScale * (openingScore * early + endgameScore * (1 - early));
    if (scale === 0 || material === 0 || whiteKing < 0 || blackKing < 0) return material + boundedPositionBonus(positional);
    const whiteAhead = material > 0;
    // Pawn-only advantages should seek promotion, rather than chase the enemy king.
    if (whiteAhead ? !whiteHasNonPawn : !blackHasNonPawn) return material + boundedPositionBonus(positional);
    const weight = endgameWeight(whiteAhead ? blackPieces : whitePieces)
        * Math.min(1, Math.abs(material) / pieceDefinitions.rook.value);
    const bonus = ForceKingToCheckmateEval(whiteAhead ? whiteKing : blackKing, whiteAhead ? blackKing : whiteKing, weight, scale);
    return material + boundedPositionBonus(positional + (whiteAhead ? bonus : -bonus));
}
