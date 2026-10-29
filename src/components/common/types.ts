export type PieceName = "king" | "queen" | "rook" | "diagonalrook" | "bishop" | "knight" | "pawn";

export type Color = "white" | "black";

export type Board = (string | null)[][];

export type BasicMove = {
    from: number;
    to: number;
    kind: "m" | "c" | "ch" | "p"; //c-capture, m-move, ch-checkers, p-promote
} | {
    from: number;
    to: number;
    kind: "rotate";
    piece: "rook" | "diagonalrook";
};

export const pieceNames: Record<string, PieceName> = {
    k: "king",
    q: "queen",
    r: "rook",
    b: "bishop",
    n: "knight",
    p: "pawn",
};

export const offsetsS = [-8, 8, -1, 1]
export const offsetsD = [-9, -7, 7, 9]