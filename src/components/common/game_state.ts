import { MATE_SCORE, pieceColor, promotionPieces } from "../utils/pieces";
import { applyMove } from "./apply_move";
import { legalMovesForPiece as LegalMoveGenerate, kingSafe } from "./rules";
import { createCastlingState, createStandardState, cloneStandardState } from "../utils/types";
import { automaticDrawReason, nextHalfmoveClock } from "./draw_rules";
import type { AutomaticDrawReason } from "./draw_rules";
import type { BasicMove, Board, Color, PromotionPiece, CastlingState, StandardState, Ruleset } from "../utils/types";

export type Square = [number, number];
export { promotionPieces } from "../utils/pieces";
export type { PromotionPiece } from "../utils/types";
export type GameStatus =
    | { kind: "playing" | "check" }
    | { kind: "checkmate"; winner: Color }
    | { kind: "resigned"; winner: Color }
    | { kind: "draw"; reason: "agreement" | "timeout" | "abandoned" | AutomaticDrawReason }
    | { kind: "timeout" | "disconnect"; winner: Color }
    | { kind: "stalemate" };

export type FinishedStatus = Extract<GameStatus, { kind: "checkmate" | "resigned" | "draw" | "stalemate" | "timeout" | "disconnect" }>;
export function isGameOver(status: GameStatus): status is FinishedStatus {
    return status.kind !== "playing" && status.kind !== "check";
}

/** Search must use terminal results before material evaluation. Null means play continues. */
export function gameResultScore(status: GameStatus): number | null {
    if ("winner" in status) return status.winner === "white" ? MATE_SCORE : -MATE_SCORE;
    if (status.kind === "stalemate" || status.kind === "draw") return 0;
    return null;
}

export function getGameStatus(board: Board, turn: Color, castling: CastlingState = createCastlingState(), standard?: StandardState, halfmoveClock = 0): GameStatus {
    const safe = kingSafe(board, turn, standard);
    for (let square = 0; square < board.length; square++) {
        if (pieceColor(board[square]) === turn && LegalMoveGenerate(board, square, castling, standard).length > 0) {
            const draw = automaticDrawReason(board, standard ? "normal" : "chaos", halfmoveClock);
            return draw ? { kind: "draw", reason: draw } : { kind: safe ? "playing" : "check" };
        }
    }

    return safe
        ? { kind: "stalemate" }
        : { kind: "checkmate", winner: turn === "white" ? "black" : "white" };
}

export type GameState = {
    board: Board;
    ruleset: Ruleset;
    standard?: StandardState;
    castling: CastlingState;
    turn: Color;
    selectedSquare: Square | null;
    lastMove: BasicMove | null;
    capturedPieces?: number[];
    status: GameStatus;
    drawOffer: Color | null;
    halfmoveClock: number;
    /** Elapsed half-moves; absent in legacy saves with unknown game age. */
    plyCount?: number;
    pendingPromotion: {
        square: Square;
        color: Color;
        boardBefore: Board;
        moves: BasicMove[];
    } | null;
};



export type GameAction = { type: "click"; square: Square } | { type: "rotate" } | { type: "restart"; board: Board } | { type: "promote"; piece: PromotionPiece }
    | { type: "resign"; color: Color } | { type: "offer-draw"; color: Color }
    | { type: "respond-draw"; color: Color; accept: boolean }
    | { type: "engine-move"; move: BasicMove; expectedBoard: Board; turn: Color };

export function createGame(board: Board, turn: Color = "white", castling: CastlingState = createCastlingState(), ruleset: Ruleset = "chaos", standardState: StandardState = createStandardState(), halfmoveClock = 0): GameState {
    const flags = { ...castling };
    const standard = ruleset === "normal" ? cloneStandardState(standardState) : undefined;
    return { board, ruleset, standard, castling: flags, turn, selectedSquare: null, lastMove: null, capturedPieces: [], status: getGameStatus(board, turn, flags, standard, halfmoveClock), halfmoveClock, plyCount: 0, drawOffer: null, pendingPromotion: null };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
    if (action.type === "restart") return createGame(action.board, "white", createCastlingState(), state.ruleset);
    if (isGameOver(state.status)) return state;
    if (action.type === "resign") return {
        ...state, board: state.pendingPromotion?.boardBefore ?? state.board,
        status: { kind: "resigned", winner: action.color === "white" ? "black" : "white" },
        selectedSquare: null, pendingPromotion: null, drawOffer: null,
    };
    if (action.type === "offer-draw") {
        if (state.pendingPromotion || state.drawOffer) return state;
        return { ...state, drawOffer: action.color, selectedSquare: null };
    }
    if (action.type === "respond-draw") {
        if (!state.drawOffer || action.color === state.drawOffer) return state;
        return { ...state, drawOffer: null, selectedSquare: null,
            status: action.accept ? { kind: "draw", reason: "agreement" } : state.status };
    }
    if (state.pendingPromotion) {
        if (action.type !== "promote" || !promotionPieces.includes(action.piece)) return state;
        const { boardBefore, moves } = state.pendingPromotion;
        const move = moves.find(candidate => candidate.kind !== "rotate" && candidate.promotion === action.piece);
        if (!move) return state;
        return completeMove({ ...state, board: boardBefore }, move);
    }
    if (action.type === "promote") return state;

    if (action.type === "engine-move") {
        // Ignore stale worker results after a restart, and only accept complete legal moves.
        if (action.expectedBoard !== state.board || action.turn !== state.turn || pieceColor(state.board[action.move.from]) !== state.turn) return state;
        const move = LegalMoveGenerate(state.board, action.move.from, state.castling, state.standard).find(candidate =>
            candidate.to === action.move.to && candidate.kind === action.move.kind &&
            (candidate.kind === "rotate" ? action.move.kind === "rotate" && candidate.piece === action.move.piece
                : candidate.kind === "castle" ? action.move.kind === "castle" && candidate.rookFrom === action.move.rookFrom && candidate.rookTo === action.move.rookTo
                : candidate.kind === "en-passant" ? action.move.kind === "en-passant" && candidate.capturedSquare === action.move.capturedSquare
                : action.move.kind !== "rotate" && candidate.promotion === action.move.promotion));
        return move ? completeMove(state, move) : state;
    }

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
    const legalMoves = LegalMoveGenerate(board, selectedSquare[0] * 8 + selectedSquare[1], state.castling, state.standard);
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
    const castling = { ...state.castling };
    const standard = state.standard ? cloneStandardState(state.standard) : undefined;
    const halfmoveClock = nextHalfmoveClock(state.board, move, state.halfmoveClock);
    const board = applyMove(state.board, move, castling, standard);
    // Compare enemy pieces so promotions and rook rotations never count as captures.
    const captured = state.board.filter((piece, square) => pieceColor(piece) === (state.turn === "white" ? "black" : "white") && board[square] !== piece);
    const turn = state.turn === "white" ? "black" : "white";
    return {
        board,
        ruleset: state.ruleset,
        standard,
        castling,
        turn,
        selectedSquare: null,
        lastMove: move,
        capturedPieces: [...(state.capturedPieces ?? []), ...captured],
        status: getGameStatus(board, turn, castling, standard, halfmoveClock),
        halfmoveClock,
        plyCount: state.plyCount === undefined ? undefined : state.plyCount + 1,
        drawOffer: state.drawOffer === turn ? null : state.drawOffer,
        pendingPromotion: null,
    };
}
