export type PieceName = "king" | "queen" | "rook" | "diagonalrook" | "bishop" | "knight" | "pawn";
export type PieceValue = number

export type Color = "white" | "black";

export type Board = number[][];

export type BasicMove = {
    from: number;
    to: number;
    kind: "m" | "c" | "ch" | "p"; //c-capture, m-move, ch-checkers, p-promote
} | {
    from: number;
    to: number;
    kind: "rotate";
    piece: PieceName;
};

export { pieceIds, pieceNames } from "./pieces";

export const pieceValues: Record<string, PieceValue> = {
    q: 800,
    r: 500,
    k: 400,
    b: 200,
    p: 100,
}

export const offsetsS = [-8, 8, -1, 1]
export const offsetsD = [-9, -7, 7, 9]