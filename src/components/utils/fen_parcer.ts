import { makePiece, pieceNames, pieceDefinition } from "./pieces";
import { createStandardState } from "./types";
import type { Board, Color, StandardState } from "./types";

export function standardStateFromFen(fen: string): StandardState {
    const fields = fen.trim().split(/\s+/);
    const state = createStandardState();
    const rights = fields[2] ?? "-";
    state.castlingRights.white = { kingSide: rights.includes("K"), queenSide: rights.includes("Q") };
    state.castlingRights.black = { kingSide: rights.includes("k"), queenSide: rights.includes("q") };
    const target = fields[3];
    state.enPassantTarget = target && target !== "-" ? (8 - Number(target[1])) * 8 + "abcdefgh".indexOf(target[0]) : null;
    return state;
}

/** D/d denotes a diagonal rook in Chaos FEN; normal chess uses standard symbols. */
export function formatFen(board: Board, turn: Color, standard?: StandardState, halfmoveClock = 0): string {
    const ranks: string[] = [];
    for (let row = 0; row < 8; row++) {
        let rank = "", empty = 0;
        for (let col = 0; col < 8; col++) {
            const piece = board[row * 8 + col];
            if (piece === 0) { empty++; continue; }
            if (empty) { rank += empty; empty = 0; }
            const symbol = pieceDefinition(piece)!.fen!;
            rank += piece > 0 ? symbol.toUpperCase() : symbol;
        }
        if (empty) rank += empty;
        ranks.push(rank);
    }
    const rights = standard ? `${standard.castlingRights.white.kingSide ? "K" : ""}${standard.castlingRights.white.queenSide ? "Q" : ""}${standard.castlingRights.black.kingSide ? "k" : ""}${standard.castlingRights.black.queenSide ? "q" : ""}` : "";
    const target = standard?.enPassantTarget;
    const ep = target != null ? `${"abcdefgh"[target % 8]}${8 - Math.floor(target / 8)}` : "-";
    return `${ranks.join("/")} ${turn === "white" ? "w" : "b"} ${rights || "-"} ${ep} ${halfmoveClock} 1`;
}

export function parseFen(fen: string): Board {
    const ranks = fen.split(" ")[0].split("/");
    if (ranks.length !== 8) throw new Error("FEN must contain eight ranks");

    return ranks.flatMap(rank => {
        const squares: number[] = [];
        for (const char of rank) {
            if (/[1-8]/.test(char)) {
                squares.push(...Array<number>(Number(char)).fill(0));
            } else {
                const name = pieceNames[char.toLowerCase()];
                if (!name) throw new Error(`Unknown FEN piece: ${char}`);
                squares.push(makePiece(name, char === char.toUpperCase() ? "white" : "black"));
            }
        }
        if (squares.length !== 8) throw new Error("FEN ranks must contain eight squares");
        return squares;
    });
}
