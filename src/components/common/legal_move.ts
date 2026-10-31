import { offsetsS, offsetsD } from "./types";
import { pieceColor, pieceDefinition, pieceIds, horseSteps, diagonalDirections, promotionPieces } from "./pieces";
import type { BasicMove, Board, Color } from "./types";
import { findKing, isKingSafe } from "./king_safety";
import { makeMove } from "./apply_move";

export type UndoInformation = {
    movingPiece: number;
    capturedPiece: number;
    jumpedPiece: number;
};

/** Save affected square contents before makeMove changes them. */
export function saveUndoInformation(board: Board, move: BasicMove): UndoInformation {
    return {
        movingPiece: board[move.from],
        capturedPiece: board[move.to],
        jumpedPiece: move.kind === "ch" ? board[(move.from + move.to) / 2] : 0,
    };
}

export function unmakeMove(board: Board, move: BasicMove, undo: UndoInformation): void {
    board[move.from] = undo.movingPiece;
    board[move.to] = undo.capturedPiece;
    if (move.kind === "ch") board[(move.from + move.to) / 2] = undo.jumpedPiece;
}

/** Generate legal moves from a flat square index (a8 = 0, h1 = 63). */
export default function LegalMoveGenerate(board: Board, from: number) {
    const row = Math.floor(from / 8)
    const col = from % 8
    const piece = board[from]
    const moves: BasicMove[] = []

    if (!piece) return moves

    const color = pieceColor(piece) as Color
    const kingId = pieceIds.king * (color === "white" ? 1 : -1)
    const kingPos = findKing(board, kingId)
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

    function genCheckers() {
        function onBoard(r: number, c: number) {
            return r >= 0 && r < 8 && c >= 0 && c < 8;
        }

        for (const [dr, dc] of diagonalDirections) {
            const nextRow = row + dr;
            const nextCol = col + dc;

            if (!onBoard(nextRow, nextCol)) continue;

            const target = board[nextRow * 8 + nextCol];

            if (target === 0) {
                moves.push({
                    from: origin,
                    to: nextRow * 8 + nextCol,
                    kind: "m",
                });
                continue;
            }

            const landingRow = row + dr * 2;
            const landingCol = col + dc * 2;

            if (!onBoard(landingRow, landingCol)) continue;
            if (board[landingRow * 8 + landingCol] !== 0) continue;

            moves.push({
                from: origin,
                to: landingRow * 8 + landingCol,
                // Friendly jumps are quiet moves; only enemies are removed.
                kind: pieceColor(target) === color ? "m" : "ch",
            });
        }
    }

    function genPawn() {
        const forward = color === "white" ? -1 : 1;
        const nextRow = row + forward;

        if (nextRow < 0 || nextRow >= 8) return;

        // Move diagonally into empty squares.
        for (const dc of [-1, 1]) {
            const nextCol = col + dc;

            if (nextCol < 0 || nextCol >= 8) continue;

            if (board[nextRow * 8 + nextCol] === 0) {
                moves.push({
                    from: origin,
                    to: nextRow * 8 + nextCol,
                    kind: "m",
                });
            }
        }

        // Capture directly ahead.
        const target = board[nextRow * 8 + col];

        if (target !== 0 && pieceColor(target) !== color) {
            moves.push({
                from: origin,
                to: nextRow * 8 + col,
                kind: "c",
            });
        }
    }

    const movement = definition.movement;
    if (movement.straight) genStraight(movement.straight);
    if (movement.diagonal) genDiagonal(movement.diagonal);
    if (movement.horse) genHorse();
    if (movement.checkers) genCheckers();
    if (movement.pawn) genPawn();
    if (definition.rotatesTo) {
        moves.push({ from: origin, to: origin, kind: "rotate", piece: definition.rotatesTo });
    }

    // A promotion choice is part of the move, not a second turn.
    const candidates = Math.abs(piece) === pieceIds.pawn
        ? moves.flatMap((move): BasicMove[] => {
            if (move.kind !== "rotate" && Math.floor(move.to / 8) === (color === "white" ? 0 : 7)) {
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

        const undo = saveUndoInformation(board, move);

        const nextKingPos = piece === kingId ? move.to : kingPos;
        makeMove(board, move);
        try {
            return isKingSafe(board, color, nextKingPos);
        } finally {
            unmakeMove(board, move, undo);
        }
    })

}
