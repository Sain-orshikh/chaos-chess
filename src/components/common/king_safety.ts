import type { Board, Color } from "./types";
import { diagonalDirections, straightDirections, horseSteps, makePiece, pieceColor, pieceDefinition } from "./pieces";

function onBoard(row: number, col: number) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function findKing(board: Board, id: number): number {
    for (let row = 0; row < board.length; row++) {
        const col = board[row].indexOf(id);
        if (col !== -1) return row * 8 + col;
    }
    return -1;
}

/** Pass the king's square in this board to avoid searching again for each candidate. */
export function isKingSafe(board: Board, color: Color, kingPos = findKing(board, makePiece("king", color))): boolean {
    if (!Number.isInteger(kingPos) || kingPos < 0 || kingPos >= 64) return false;
    const kingRow = Math.floor(kingPos / 8);
    const kingCol = kingPos % 8;
    if (board[kingRow][kingCol] !== makePiece("king", color)) return false;
    const enemy = color === "white" ? "black" : "white";
    function enemyMovement(row: number, col: number) {
        if (!onBoard(row, col)) return undefined;
        const piece = board[row][col];
        return pieceColor(piece) === enemy ? pieceDefinition(piece)?.movement : undefined;
    }

    for (const [dr, dc] of horseSteps) {
        if (enemyMovement(kingRow + dr, kingCol + dc)?.horse) return false;
    }

    const enemyForward = enemy === "white" ? -1 : 1;
    if (enemyMovement(kingRow - enemyForward, kingCol)?.pawn) return false;

    // Jump captures require an empty landing square beyond the king.
    for (const [dr, dc] of diagonalDirections) {
        const landingRow = kingRow - dr;
        const landingCol = kingCol - dc;
        if (enemyMovement(kingRow + dr, kingCol + dc)?.checkers &&
            onBoard(landingRow, landingCol) && board[landingRow][landingCol] === 0) return false;
    }

    for (const [directions, kind] of [[straightDirections, "straight"], [diagonalDirections, "diagonal"]] as const) {
        for (const [dr, dc] of directions) {
            for (let distance = 1; distance <= 7; distance++) {
                const row = kingRow + dr * distance;
                const col = kingCol + dc * distance;
                if (!onBoard(row, col)) break;
                if (board[row][col] === 0) continue;
                if ((enemyMovement(row, col)?.[kind] ?? 0) >= distance) return false;
                break;
            }
        }
    }
    return true;
}
