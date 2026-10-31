import { parseFen } from "../utils/fen_parcer";
import { isKingSafe } from "../utils/king_safety";
import { makePiece, pieceIds } from "../utils/pieces";
import type { Board, Color } from "../utils/types";

export const benchmarkPositions = [
    { id: "random", name: "Random middlegame", detail: "27 pieces · our seeded test position", fen: "r1b1kn1r/p1npp2p/pp1bp2Q/8/2P2PP1/B4KP1/P1q5/R4BNR w - - 0 17" },
    { id: "start", name: "Starting position", detail: "32 pieces · crowded opening", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1" },
    { id: "crowded", name: "Crowded middlegame", detail: "30 pieces · blocked paths", fen: "r2q1rk1/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R2Q1RK1 w - - 0 1" },
    { id: "open", name: "Open middlegame", detail: "16 pieces · many available moves", fen: "r3k2r/1p3p2/2n3p1/3q4/3Q4/2N3P1/1P3P2/R3K2R w - - 0 1" },
    { id: "queens", name: "Queens & rooks", detail: "6 pieces · long sliding paths", fen: "4k2r/8/8/3q4/8/3Q4/8/R3K3 w - - 0 1" },
    { id: "pawns", name: "Pawn endgame", detail: "4 pieces · a small search tree", fen: "7k/5p2/8/8/8/8/2P5/K7 w - - 0 1" },
    { id: "promotion", name: "Promotion race", detail: "4 pieces · four promotion choices", fen: "7k/2P5/8/8/8/8/5p2/K7 w - - 0 1" },
] as const;

export type BenchmarkPosition = { board: Board; turn: Color; fen: string };

/** Strict validation at the custom-input boundary; engine rules remain Chaos Chess. */
export function parseBenchmarkFen(input: string): BenchmarkPosition {
    const fields = input.trim().split(/\s+/);
    if (![1, 2, 6].includes(fields.length)) throw new Error("Enter a board layout, layout plus turn, or a complete six-field FEN.");
    if (fields[1] !== undefined && !["w", "b"].includes(fields[1])) throw new Error("The side to move must be w or b.");
    if (fields.length === 6) {
        if (!/^(?:-|K?Q?k?q?)$/.test(fields[2])) throw new Error("Invalid castling field.");
        if (!/^(?:-|[a-h][36])$/.test(fields[3])) throw new Error("Invalid en passant field.");
        if (!/^\d+$/.test(fields[4]) || !/^\d+$/.test(fields[5]) || !Number.isSafeInteger(Number(fields[4])) || !Number.isSafeInteger(Number(fields[5])) || Number(fields[5]) < 1) throw new Error("Invalid move counters.");
    }
    const board = parseFen(fields[0]);
    for (const color of ["white", "black"] as const) {
        if (board.filter(piece => piece === makePiece("king", color)).length !== 1) throw new Error("The position must contain exactly one king of each color.");
    }
    if (board.some((piece, square) => Math.abs(piece) === pieceIds.pawn && (square < 8 || square >= 56))) throw new Error("Pawns on the first or eighth rank must already be promoted.");
    const turn = fields[1] === "b" ? "black" : "white";
    if (!isKingSafe(board, turn === "white" ? "black" : "white")) throw new Error("The king of the side that just moved cannot be left in check.");
    return { board, turn, fen: fields.length === 6 ? fields.join(" ") : `${fields[0]} ${fields[1] ?? "w"} - - 0 1` };
}
