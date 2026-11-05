export type PieceName = "king" | "queen" | "rook" | "diagonalrook" | "bishop" | "knight" | "pawn";
export type PieceValue = number

export type Color = "white" | "black";
export type Ruleset = "chaos" | "normal";
export type StandardState = {
    castlingRights: Record<Color, { kingSide: boolean; queenSide: boolean }>;
    enPassantTarget: number | null;
};
export function createStandardState(): StandardState {
    return { castlingRights: { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } }, enPassantTarget: null };
}
export function cloneStandardState(state: StandardState): StandardState {
    return { castlingRights: { white: { ...state.castlingRights.white }, black: { ...state.castlingRights.black } }, enPassantTarget: state.enPassantTarget };
}
export type PromotionPiece = "queen" | "rook" | "bishop" | "knight";

// Squares run from a8 = 0 to h1 = 63; square = row * 8 + col.
export type Board = number[];
// True means this color has already used its one castle, regardless of piece movement history.
export type CastlingState = Record<Color, boolean>;
export function createCastlingState(): CastlingState { return { white: false, black: false }; }

export type BasicMove = {
    from: number;
    to: number;
    kind: "m" | "c" | "ch"; // Capture, quiet move, or checkers capture.
    promotion?: PromotionPiece;
} | {
    from: number;
    to: number;
    kind: "rotate";
    piece: PieceName;
} | {
    from: number;
    to: number;
    kind: "castle";
    rookFrom: number;
    rookTo: number;
    promotion?: never;
} | {
    from: number;
    to: number;
    kind: "en-passant";
    capturedSquare: number;
    promotion?: never;
};

export { pieceIds, pieceNames } from "./pieces";

export const offsetsS = [-8, 8, -1, 1]
export const offsetsD = [-9, -7, 7, 9]

export type TranspositionEntry = {
    hash: bigint;
    depth: number;
    score: number;
    bound: "exact" | "lower" | "upper";
    bestMove: BasicMove | null;
};
