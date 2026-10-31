import { MATE_SCORE, pieceColor, promotionPieces } from "../utils/pieces";
import { applyMove } from "./apply_move";
import LegalMoveGenerate from "./legal_move";
import { isKingSafe } from "../utils/king_safety";
import type { BasicMove, Board, Color, PromotionPiece } from "../utils/types";

export type Square = [number, number];
export { promotionPieces } from "../utils/pieces";
export type { PromotionPiece } from "../utils/types";
export type GameStatus =
    | { kind: "playing" | "check" }
    | { kind: "checkmate"; winner: Color }
    | { kind: "stalemate" };

/** Search must use terminal results before material evaluation. Null means play continues. */
export function gameResultScore(status: GameStatus): number | null {
    if (status.kind === "checkmate") return status.winner === "white" ? MATE_SCORE : -MATE_SCORE;
    if (status.kind === "stalemate") return 0;
    return null;
}

export function getGameStatus(board: Board, turn: Color): GameStatus {
    const safe = isKingSafe(board, turn);
    for (let square = 0; square < board.length; square++) {
        if (pieceColor(board[square]) === turn && LegalMoveGenerate(board, square).length > 0) {
            return { kind: safe ? "playing" : "check" };
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
    pendingPromotion: {
        square: Square;
        color: Color;
        boardBefore: Board;
        moves: BasicMove[];
    } | null;
};



type GameAction = { type: "click"; square: Square } | { type: "rotate" } | { type: "restart"; board: Board } | { type: "promote"; piece: PromotionPiece };

export function createGame(board: Board, turn: Color = "white"): GameState {
    return { board, turn, selectedSquare: null, lastMove: null, status: getGameStatus(board, turn), pendingPromotion: null };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
    if (action.type === "restart") return createGame(action.board);
    if (state.pendingPromotion) {
        if (action.type !== "promote" || !promotionPieces.includes(action.piece)) return state;
        const { boardBefore, moves } = state.pendingPromotion;
        const move = moves.find(candidate => candidate.kind !== "rotate" && candidate.promotion === action.piece);
        if (!move) return state;
        return completeMove({ ...state, board: boardBefore }, move);
    }
    if (action.type === "promote") return state;
    if (state.status.kind === "checkmate" || state.status.kind === "stalemate") return state;

    const { board, turn, selectedSquare } = state;

    if (action.type === "click") {
        const [row, col] = action.square;
        if (row < 0 || row >= 8 || col < 0 || col >= 8) return state;

        if (!selectedSquare) {
            if (pieceColor(board[row * 8 + col]) !== turn) return state;
            return { ...state, selectedSquare: action.square };
        }

        if (selectedSquare[0] === row && selectedSquare[1] === col) {
            return { ...state, selectedSquare: null };
        }
    }

    if (!selectedSquare) return state;
    const legalMoves = LegalMoveGenerate(board, selectedSquare[0] * 8 + selectedSquare[1]);
    const move = legalMoves.find((candidate) =>
        action.type === "rotate"
            ? candidate.kind === "rotate"
            : candidate.kind !== "rotate" && candidate.to === action.square[0] * 8 + action.square[1]
    );

    // Rejected placements keep the selection, position, and turn unchanged.
    if (!move) return state;

    if (move.kind !== "rotate" && move.promotion) {
        // Preview the pawn's destination while the human chooses a complete generated move.
        // Search and real move application never use this intermediate board.
        const preview = board.slice();
        preview[move.to] = preview[move.from];
        preview[move.from] = 0;
        return {
            ...state,
            board: preview,
            selectedSquare: null,
            lastMove: { from: move.from, to: move.to, kind: move.kind },
            pendingPromotion: {
                square: [Math.floor(move.to / 8), move.to % 8],
                color: turn,
                boardBefore: board,
                moves: legalMoves.filter(candidate => candidate.kind !== "rotate" && candidate.to === move.to && candidate.promotion),
            },
        };
    }
    return completeMove(state, move);
}

function completeMove(state: GameState, move: BasicMove): GameState {
    const board = applyMove(state.board, move);
    const turn = state.turn === "white" ? "black" : "white";
    return {
        board,
        turn,
        selectedSquare: null,
        lastMove: move,
        status: getGameStatus(board, turn),
        pendingPromotion: null,
    };
}
