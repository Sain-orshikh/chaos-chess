import { makeMove } from "./apply_move";
import { legalMovesForPiece } from "./rules";
import { parseFen, formatFen } from "../utils/fen_parcer";
import { createCastlingState, createStandardState } from "../utils/types";
import type { BasicMove, Board, CastlingState, Color, StandardState } from "../utils/types";

import { openingLines } from "./opening_book_data";
export { openingLines } from "./opening_book_data";

// Independent first-move preferences; later positions retain their repertoire weights.
export const openingFirstMoveWeights: Readonly<Record<string, number>> = {
    e2e4: 99, d2d4: 188, c2c4: 28, g1f3: 16,
};

export const openingMoveCaps = { rooke: 7, kestrel: 5, merlin: 5 } as const;
type BotId = keyof typeof openingMoveCaps;
type Position = { board: Board; turn: Color; castling: CastlingState; standard?: StandardState; plyCount?: number };
type Entry = { move: BasicMove; weight: number };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Preserve every state field relevant to legality, including castling and en passant.
function positionKey(position: Position): string {
    return `${formatFen(position.board, position.turn, position.standard).split(" ").slice(0, 4).join(" ")}|${Number(position.castling.white)}${Number(position.castling.black)}`;
}

let book: Map<string, Entry[]> | undefined;
function getBook(): Map<string, Entry[]> {
    if (book) return book;
    const result = new Map<string, Entry[]>();
    for (const line of openingLines) {
        const position: Position = { board: parseFen(START), turn: "white", castling: createCastlingState(), standard: createStandardState() };
        for (const uci of line.moves.split(" ")) {
            const square = (s: string) => (8 - Number(s[1])) * 8 + "abcdefgh".indexOf(s[0]);
            const from = square(uci.slice(0, 2)), to = square(uci.slice(2, 4));
            const move = legalMovesForPiece(position.board, from, position.castling, position.standard).find(candidate => candidate.to === to && candidate.kind !== "rotate");
            if (!move) throw new Error(`Illegal opening book move: ${line.name} ${uci}`);
            const key = positionKey(position);
            const entries = result.get(key) ?? [];
            const existing = entries.find(entry => entry.move.from === from && entry.move.to === to);
            if (existing) existing.weight += line.weight;
            else entries.push({ move, weight: line.weight });
            result.set(key, entries);
            makeMove(position.board, move, position.castling, position.standard);
            position.turn = position.turn === "white" ? "black" : "white";
        }
    }
    const initial: Position = { board: parseFen(START), turn: "white", castling: createCastlingState(), standard: createStandardState() };
    const initialEntries = result.get(positionKey(initial));
    for (const entry of initialEntries ?? []) {
        const square = (index: number) => `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`;
        const uci = `${square(entry.move.from)}${square(entry.move.to)}`;
        entry.weight = openingFirstMoveWeights[uci] ?? entry.weight;
    }
    book = result;
    return book;
}

/** Pure seeded choice: retries/resumes keep a move, new games get fresh variety. */
export function chooseOpeningMove(position: Position, botId: BotId, seed: number): BasicMove | null {
    const { plyCount } = position;
    if (!position.standard || typeof plyCount !== "number" || !Number.isSafeInteger(plyCount) || plyCount < 0 || plyCount >= openingMoveCaps[botId] * 2) return null;
    const key = positionKey(position);
    const entries = getBook().get(key)?.filter(entry =>
        legalMovesForPiece(position.board, entry.move.from, position.castling, position.standard).some(move => JSON.stringify(move) === JSON.stringify(entry.move)));
    if (!entries?.length) return null;
    // Avalanche a game seed together with the current position and actual elapsed plies.
    let hash = seed >>> 0;
    for (const char of `${key}|${plyCount}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
    hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
    const random = ((hash ^ (hash >>> 15)) >>> 0) / 0x100000000;
    let remaining = random * entries.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of entries) {
        remaining -= entry.weight;
        if (remaining < 0) return { ...entry.move };
    }
    return { ...entries[entries.length - 1].move };
}
