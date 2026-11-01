export type PieceName = "king" | "queen" | "rook" | "diagonalrook" | "bishop" | "knight" | "pawn";
export type PieceValue = number

export type Color = "white" | "black";
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
};

export { pieceIds, pieceNames } from "./pieces";

export const offsetsS = [-8, 8, -1, 1]
export const offsetsD = [-9, -7, 7, 9]
