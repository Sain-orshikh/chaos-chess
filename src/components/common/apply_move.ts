import { makePiece, pieceColor, pieceDefinition, pieceIds, promotionPieces } from "../utils/pieces";
import { createCastlingState } from "../utils/types";
import type { BasicMove, Board, CastlingState, StandardState } from "../utils/types";

function updateStandardState(board: Board, move: BasicMove, state: StandardState): void {
    const piece = board[move.from];
    const color = pieceColor(piece)!;
    if (Math.abs(piece) === pieceIds.king) {
        state.castlingRights[color].kingSide = false;
        state.castlingRights[color].queenSide = false;
    }
    for (const side of ["white", "black"] as const) {
        const home = side === "white" ? 60 : 4;
        for (const [square, right] of [[home + 3, "kingSide"], [home - 4, "queenSide"]] as const) {
            if ((move.from === square && piece === makePiece("rook", side)) ||
                (move.to === square && board[square] === makePiece("rook", side))) state.castlingRights[side][right] = false;
        }
    }
    state.enPassantTarget = Math.abs(piece) === pieceIds.pawn && Math.abs(move.to - move.from) === 16
        ? (move.from + move.to) / 2 : null;
}

/** Apply an already validated move directly to the supplied board. */
export function makeMove(board: Board, move: BasicMove, castling: CastlingState = createCastlingState(), standard?: StandardState): Board {
    const piece = board[move.from];
    if (!piece) throw new Error("Cannot move an empty square");

    if (move.kind === "rotate") {
        if (standard) throw new Error("Standard pieces cannot rotate");
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
        if (standard) {
            if (!standard.castlingRights[color][kingSide ? "kingSide" : "queenSide"]) throw new Error("Castling right has been lost");
            updateStandardState(board, move, standard);
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

    if (move.kind === "en-passant") {
        const forward = color === "white" ? -8 : 8;
        if (!standard || Math.abs(piece) !== pieceIds.pawn || standard.enPassantTarget !== move.to ||
            board[move.to] !== 0 || move.capturedSquare !== move.to - forward ||
            Math.floor(move.from / 8) !== (color === "white" ? 3 : 4) ||
            Math.floor(move.to / 8) !== Math.floor(move.from / 8) + forward / 8 ||
            Math.abs(move.from % 8 - move.to % 8) !== 1 ||
            board[move.capturedSquare] !== makePiece("pawn", color === "white" ? "black" : "white")) throw new Error("Invalid en passant");
    }
    if (standard) updateStandardState(board, move, standard);
    if (move.kind === "en-passant") board[move.capturedSquare] = 0;

    if (move.kind === "ch") {
        // A bishop jump captures the square halfway between source and destination.
        board[(move.from + move.to) / 2] = 0;
    }

    board[move.from] = 0;
    board[move.to] = move.promotion ? makePiece(move.promotion, color) : piece;
    return board;
}

/** Copy the board for a game update; update the supplied castling flags in place. */
export function applyMove(board: Board, move: BasicMove, castling: CastlingState = createCastlingState(), standard?: StandardState): Board {
    const nextBoard = board.slice();
    makeMove(nextBoard, move, castling, standard);
    return nextBoard;
}
