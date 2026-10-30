import type { Color, PieceName } from "./types";

type Movement = {
    straight?: number;
    diagonal?: number;
    horse?: boolean;
    pawn?: boolean;
    checkers?: boolean;
};

type PieceDefinition = {
    id: number;
    label: string;
    image: string;
    fen?: string;
    movement: Movement;
    rotatesTo?: PieceName;
};

// IDs describe piece forms, not individual pieces or evaluation scores.
// A rotated rook is a registered form with the same rules API as every other piece.
export const pieceDefinitions: Record<PieceName, PieceDefinition> = {
    pawn: { id: 1, label: "pawn", image: "pawn", fen: "p", movement: { pawn: true } },
    knight: { id: 2, label: "knight", image: "knight", fen: "n", movement: { straight: 2, diagonal: 2 } },
    bishop: { id: 3, label: "bishop", image: "bishop", fen: "b", movement: { checkers: true } },
    rook: { id: 4, label: "rook", image: "rook", fen: "r", movement: { straight: 7 }, rotatesTo: "diagonalrook" },
    diagonalrook: { id: 5, label: "diagonal rook", image: "rook-diagonal", movement: { diagonal: 7 }, rotatesTo: "rook" },
    queen: { id: 6, label: "queen", image: "queen", fen: "q", movement: { straight: 7, horse: true } },
    king: { id: 7, label: "king", image: "king", fen: "k", movement: { straight: 1, diagonal: 1 } },
};

const names = Object.keys(pieceDefinitions) as PieceName[];
export const pieceIds = Object.fromEntries(names.map(name => [name, pieceDefinitions[name].id])) as Record<PieceName, number>;
export const pieceNames = Object.fromEntries(names.flatMap(name => {
    const fen = pieceDefinitions[name].fen;
    return fen ? [[fen, name]] : [];
})) as Record<string, PieceName>;
const namesById = Object.fromEntries(names.map(name => [pieceDefinitions[name].id, name])) as Record<number, PieceName>;
const definitionsById = Object.fromEntries(names.map(name => [pieceDefinitions[name].id, pieceDefinitions[name]])) as Record<number, PieceDefinition>;

export function pieceColor(piece: number): Color | null {
    return piece === 0 ? null : piece > 0 ? "white" : "black";
}

export function pieceName(piece: number): PieceName {
    const name = namesById[Math.abs(piece)];
    if (!name) throw new Error(`Unknown piece code: ${piece}`);
    return name;
}

export function pieceDefinition(piece: number): PieceDefinition | undefined {
    return definitionsById[Math.abs(piece)];
}

export function makePiece(name: PieceName, color: Color): number {
    return pieceIds[name] * (color === "white" ? 1 : -1);
}

export const straightDirections = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
export const diagonalDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
export const horseSteps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;
