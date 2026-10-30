import { makePiece, pieceColor, pieceDefinition } from "./pieces";
import type { BasicMove, Board } from "./types";

/** Apply an already validated move without changing the original position. */
export function makeMove(board: Board, move: BasicMove): Board {
    const piece = board[move.from];
    if (!piece) throw new Error("Cannot move an empty square");

    // This copies all 64 entries. Legal generation does this once per candidate.
    if (move.kind === "rotate") {
        if (pieceDefinition(piece)?.rotatesTo !== move.piece) {
            throw new Error("Invalid piece rotation");
        }
        board[move.from] = makePiece(move.piece, pieceColor(piece)!);
        return board;
    }

    if (move.kind === "ch") {
        // A bishop jump captures the square halfway between source and destination.
        board[(move.from + move.to) / 2] = 0;
    }

    board[move.from] = 0;
    board[move.to] = piece;
    return board;
}

export function applyMove(board: Board, move: BasicMove): Board {
    const nextBoard = board.slice();
    makeMove(nextBoard, move);
    return nextBoard;
}
