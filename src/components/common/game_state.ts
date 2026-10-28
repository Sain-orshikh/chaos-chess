import { applyMove } from "./apply_move";
import LegalMoveGenerate from "./legal_move";
import { isKingSafe } from "./king_safety";
import type { BasicMove, Board, Color } from "./types";

export type Square = [number, number];
export type GameStatus =
    | { kind: "playing" | "check" }
    | { kind: "checkmate"; winner: Color }
    | { kind: "stalemate" };

export function getGameStatus(board: Board, turn: Color): GameStatus {
    const safe = isKingSafe(board, turn);
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (board[row][col]?.split("-")[0] === turn && LegalMoveGenerate(board, [row, col]).length > 0) {
                return { kind: safe ? "playing" : "check" };
            }
        }
    }

    return safe
        ? { kind: "stalemate" }
        : { kind: "checkmate", winner: turn === "white" ? "black" : "white" };
}

export type GameState = {
    board: Board;
    turn: Color;
    selectedSquare: Square | null;
    lastMove: BasicMove | null;
    status: GameStatus;
};

type GameAction = { type: "click"; square: Square } | { type: "rotate" } | { type: "restart"; board: Board };

export function createGame(board: Board, turn: Color = "white"): GameState {
    return { board, turn, selectedSquare: null, lastMove: null, status: getGameStatus(board, turn) };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
    if (action.type === "restart") return createGame(action.board);
    if (state.status.kind === "checkmate" || state.status.kind === "stalemate") return state;

    const { board, turn, selectedSquare } = state;

    if (action.type === "click") {
        const [row, col] = action.square;
        if (row < 0 || row >= 8 || col < 0 || col >= 8) return state;

        if (!selectedSquare) {
            if (board[row][col]?.split("-")[0] !== turn) return state;
            return { ...state, selectedSquare: action.square };
        }

        if (selectedSquare[0] === row && selectedSquare[1] === col) {
            return { ...state, selectedSquare: null };
        }
    }

    if (!selectedSquare) return state;
    const move = LegalMoveGenerate(board, selectedSquare).find((candidate) =>
        action.type === "rotate"
            ? candidate.kind === "rotate"
            : candidate.kind !== "rotate" && candidate.to === action.square[0] * 8 + action.square[1]
    );

    // Rejected placements keep the selection, position, and turn unchanged.
    if (!move) return state;

    const nextBoard = applyMove(board, move);
    const nextTurn = turn === "white" ? "black" : "white";
    return {
        board: nextBoard,
        turn: nextTurn,
        selectedSquare: null,
        lastMove: move,
        status: getGameStatus(nextBoard, nextTurn),
    };
}
