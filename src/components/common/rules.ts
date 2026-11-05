import chaosMoves from "./legal_move";
import normalMoves from "./normal/normal_legal_move";
import { isKingSafe as chaosSafe } from "../utils/king_safety";
import { isKingSafe as normalSafe } from "./normal/normal_king_safety";
import type { Board, Color, CastlingState, StandardState } from "../utils/types";

// Standard state is supplied only for normal chess. Chaos retains its original rules.
export function legalMovesForPiece(board: Board, from: number, castling: CastlingState, standard?: StandardState) {
    return standard ? normalMoves(board, from, castling, standard) : chaosMoves(board, from, castling);
}

export function kingSafe(board: Board, color: Color, standard?: StandardState) {
    return standard ? normalSafe(board, color) : chaosSafe(board, color);
}
