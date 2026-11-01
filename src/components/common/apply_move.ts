import { makePiece, pieceColor, pieceDefinition, pieceIds, promotionPieces } from "../utils/pieces";
import { createCastlingState } from "../utils/types";
import type { BasicMove, Board, CastlingState } from "../utils/types";

/** Apply an already validated move directly to the supplied board. */
export function makeMove(board: Board, move: BasicMove, castling: CastlingState = createCastlingState()): Board {
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
    if (move.kind === "castle") {
        const home = color === "white" ? 60 : 4;
        const kingSide = move.to === home + 2;
        const rookFrom = home + (kingSide ? 3 : -4);
        const rookTo = home + (kingSide ? 1 : -1);
        if (piece !== makePiece("king", color) || move.from !== home ||
            (!kingSide && move.to !== home - 2) || move.rookFrom !== rookFrom || move.rookTo !== rookTo ||
            board[rookFrom] !== makePiece("rook", color) || castling[color]) throw new Error("Invalid castle");
        for (let square = Math.min(home, rookFrom) + 1; square < Math.max(home, rookFrom); square++) {
            if (board[square] !== 0) throw new Error("Castling path is blocked");
        }
        board[move.from] = 0;
        board[move.to] = piece;
        board[rookFrom] = 0;
        board[rookTo] = makePiece("rook", color);
        castling[color] = true;
        return board;
    }
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

/** Copy the board for a game update; update the supplied castling flags in place. */
export function applyMove(board: Board, move: BasicMove, castling: CastlingState = createCastlingState()): Board {
    const nextBoard = board.slice();
    makeMove(nextBoard, move, castling);
    return nextBoard;
}
