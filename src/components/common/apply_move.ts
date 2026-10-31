import { makePiece, pieceColor, pieceDefinition, pieceIds, promotionPieces } from "../utils/pieces";
import type { BasicMove, Board } from "../utils/types";

/** Apply an already validated move directly to the supplied board. */
export function makeMove(board: Board, move: BasicMove): Board {
    const piece = board[move.from];
    if (!piece) throw new Error("Cannot move an empty square");

    if (move.kind === "rotate") {
        if (pieceDefinition(piece)?.rotatesTo !== move.piece) {
            throw new Error("Invalid piece rotation");
        }
        board[move.from] = makePiece(move.piece, pieceColor(piece)!);
        return board;
    }

    const color = pieceColor(piece)!;
    const promotes = Math.abs(piece) === pieceIds.pawn && Math.floor(move.to / 8) === (color === "white" ? 0 : 7);
    if (promotes !== Boolean(move.promotion) || (move.promotion && !promotionPieces.includes(move.promotion))) {
        throw new Error("A promotion move must specify a valid promotion piece");
    }

    if (move.kind === "ch") {
        // A bishop jump captures the square halfway between source and destination.
        board[(move.from + move.to) / 2] = 0;
    }

    board[move.from] = 0;
    board[move.to] = move.promotion ? makePiece(move.promotion, color) : piece;
    return board;
}

/** Return a new position for an actual game update, preserving the original board. */
export function applyMove(board: Board, move: BasicMove): Board {
    const nextBoard = board.slice();
    makeMove(nextBoard, move);
    return nextBoard;
}
