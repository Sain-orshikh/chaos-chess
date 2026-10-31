export type PieceName = "king" | "queen" | "rook" | "diagonalrook" | "bishop" | "knight" | "pawn";
export type PieceValue = number

export type Color = "white" | "black";
export type PromotionPiece = "queen" | "rook" | "bishop" | "knight";

// Squares run from a8 = 0 to h1 = 63; square = row * 8 + col.
export type Board = number[];

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
};

export { pieceIds, pieceNames } from "./pieces";

export const offsetsS = [-8, 8, -1, 1]
export const offsetsD = [-9, -7, 7, 9]
