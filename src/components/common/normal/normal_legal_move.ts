import { offsetsS, offsetsD, createCastlingState, createStandardState } from "../../utils/types";
import { pieceColor, pieceDefinition, pieceIds, horseSteps, promotionPieces } from "../../utils/pieces";
import type { BasicMove, Board, Color, CastlingState, StandardState } from "../../utils/types";
import { findKing, isKingSafe } from "./normal_king_safety";
import { makeMove } from "./../apply_move";

import { saveUndoInformation, unmakeMove } from "../legal_move";
export { saveUndoInformation, unmakeMove } from "../legal_move";

/** Generate legal moves from a flat square index (a8 = 0, h1 = 63). */
export default function LegalMoveGenerate(board: Board, from: number, castling: CastlingState = createCastlingState(), standard: StandardState = createStandardState()) {
    const row = Math.floor(from / 8)
    const col = from % 8
    const piece = board[from]
    const moves: BasicMove[] = []

    if (!piece) return moves

    const color = pieceColor(piece) as Color
    const kingId = pieceIds.king * (color === "white" ? 1 : -1)
    const rookId = pieceIds.rook * (color === "white" ? 1 : -1)
    const kingPos = findKing(board, kingId)
    const kingOrigin = (color === "white" ? 60 : 4)
    if (kingPos === -1) return moves
    const enemyKingPos = findKing(board, -kingId)
    const definition = pieceDefinition(piece)
    if (!definition) throw new Error(`Unknown piece code: ${piece}`)
    const origin = from


    function genStraight(range: number) {

        //north, south, west, east
        const to_wall = [row, 7-row, col, 7-col]

        for (let direction=0; direction<4; direction++){
            const limit = Math.min(range, to_wall[direction])
            for (let step=1; step <= limit; step++){
                const to = origin + offsetsS[direction] * step
                const target = board[to]

                if (target !== 0){
                    const targetColor = pieceColor(target)
                    if (targetColor !== color){
                        moves.push({from: origin, to, kind: "c"})
                    }

                    break

                }

                moves.push({from: origin, to, kind: "m"})
            }
        }
    }

    function genDiagonal(range: number) {

        const diagonalWalls = [
            Math.min(row, col),         // Northwest
            Math.min(row, 7 - col),     // Northeast
            Math.min(7 - row, col),     // Southwest
            Math.min(7 - row, 7 - col), // Southeast
        ];

        for (let direction=0; direction<4; direction++){
            const limit = Math.min(range, diagonalWalls[direction])
            for (let step=1; step <= limit; step++){
                const to = origin + offsetsD[direction] * step
                const target = board[to]

                if (target !== 0){
                    const targetColor = pieceColor(target)
                    if (targetColor !== color){
                        moves.push({from: origin, to, kind: "c"})
                    }

                    break

                }

                moves.push({from: origin, to, kind: "m"})
            }
        }
    }

    function genHorse() {
        for (const [dr, dc] of horseSteps){
            const nextRow = row + dr
            const nextCol = col + dc
            if(
                nextRow<0 || nextRow >= 8 ||
                nextCol<0 || nextCol >= 8
            ) {
                continue
            }
            const target = board[nextRow * 8 + nextCol]

            if (target !== 0 && pieceColor(target) === color){
                continue
            }

            moves.push({from: origin, to: nextRow * 8 + nextCol, kind: target === 0 ? "m" : "c"})
        }
    }

    function genNormalPawn() {
        const forward = color === "white" ? -1 : 1;
        const nextRow = row + forward;

        if (nextRow < 0 || nextRow >= 8) return;

        // A double advance requires both the starting rank and a clear path.
        if (board[nextRow * 8 + col] === 0) {
            moves.push({ from: origin, to: nextRow * 8 + col, kind: "m" });
            const startingRow = color === "white" ? 6 : 1;
            const doubleRow = row + 2 * forward;
            if (row === startingRow && board[doubleRow * 8 + col] === 0) {
                moves.push({ from: origin, to: doubleRow * 8 + col, kind: "m" });
            }
        }

        // Capture diagonally ahead.
        for (const dc of [-1, 1]){

            const nextCol = col + dc;
            if (nextCol < 0 || nextCol >= 8) continue;

            const target = board[nextRow * 8 + nextCol];
            
            if (target !== 0 && pieceColor(target) !== color) {
                moves.push({
                    from: origin,
                    to: nextRow * 8 + nextCol,
                    kind: "c",
                });
            } else if (standard.enPassantTarget === nextRow * 8 + nextCol && target === 0 &&
                row === (color === "white" ? 3 : 4) && board[row * 8 + nextCol] === -piece) {
                moves.push({ from: origin, to: nextRow * 8 + nextCol, kind: "en-passant", capturedSquare: row * 8 + nextCol });
            }
        }
    }

    function genCastle() {
        if (origin !== kingOrigin || castling[color] || !isKingSafe(board, color, kingPos)) return;
        for (const [direction, distance] of [[1, 3], [-1, 4]] as const) {
            if (!standard.castlingRights[color][direction === 1 ? "kingSide" : "queenSide"]) continue;
            const rookFrom = origin + direction * distance;
            if (board[rookFrom] !== rookId) continue;
            let clear = true;
            for (let step = 1; step < distance; step++) {
                if (board[origin + direction * step] !== 0) { clear = false; break; }
            }
            if (!clear) continue;
            // Test the crossing square with the king off its starting square.
            const crossing = origin + direction;
            board[origin] = 0;
            board[crossing] = kingId;
            let crossingSafe;
            try { crossingSafe = isKingSafe(board, color, crossing); }
            finally { board[origin] = kingId; board[crossing] = 0; }
            if (crossingSafe) moves.push({ from: origin, to: origin + direction * 2, kind: "castle", rookFrom, rookTo: origin + direction });
        }
    }

    const normal_move = definition.normal_move;
    if (normal_move.straight) genStraight(normal_move.straight);
    if (normal_move.diagonal) genDiagonal(normal_move.diagonal);
    if (normal_move.horse) genHorse();
    if (normal_move.normal_pawn) genNormalPawn();
    if (normal_move.castle) genCastle();

    // A promotion choice is part of the move, not a second turn.
    const candidates = Math.abs(piece) === pieceIds.pawn
        ? moves.flatMap((move): BasicMove[] => {
            if (move.kind !== "rotate" && move.kind !== "castle" && move.kind !== "en-passant" && Math.floor(move.to / 8) === (color === "white" ? 0 : 7)) {
                return promotionPieces.map(promotion => ({ ...move, promotion }));
            }
            return [move];
        })
        : moves;

    return candidates.filter((move) => {
        const toRow = Math.floor(move.to / 8);
        const toCol = move.to % 8;
        if (move.kind !== "rotate") {
            // Kings are checked/checkmated rather than captured.
            if (move.to === enemyKingPos) return false;

            if (move.kind === "ch") {
                const capturedRow = (row + toRow) / 2;
                const capturedCol = (col + toCol) / 2;
                if ((capturedRow*8+capturedCol) === enemyKingPos) return false;
            }
        }

        const undo = saveUndoInformation(board, move, castling, standard);

        const nextKingPos = piece === kingId ? move.to : kingPos;
        makeMove(board, move, castling, standard);
        try {
            return isKingSafe(board, color, nextKingPos);
        } finally {
            unmakeMove(board, move, undo, castling, standard);
        }
    })

}
