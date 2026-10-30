import { makePiece, pieceColor, pieceDefinition } from "./pieces";
import type { BasicMove, Board } from "./types";

/** Apply an already validated move without changing the original position. */
export function applyMove(board: Board, move: BasicMove): Board {
    const fromRow = Math.floor(move.from / 8);
    const fromCol = move.from % 8;
    const toRow = Math.floor(move.to / 8);
    const toCol = move.to % 8;
    const piece = board[fromRow][fromCol];
    if (!piece) throw new Error("Cannot move an empty square");

    const nextBoard = board.map((rank) => [...rank]);
    if (move.kind === "rotate") {
        if (pieceDefinition(piece)?.rotatesTo !== move.piece) {
            throw new Error("Invalid piece rotation");
        }
        nextBoard[fromRow][fromCol] = makePiece(move.piece, pieceColor(piece)!);
        return nextBoard;
    }

    if (move.kind === "ch") {
        nextBoard[(fromRow + toRow) / 2][(fromCol + toCol) / 2] = 0;
    }

    nextBoard[fromRow][fromCol] = 0;
    nextBoard[toRow][toCol] = piece;
    return nextBoard;
}
