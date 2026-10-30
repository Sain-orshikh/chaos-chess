import { makePiece, pieceNames } from "./pieces";
import type { Board } from "./types";

export function parseFen(fen: string): Board {
    const ranks = fen.split(" ")[0].split("/");
    if (ranks.length !== 8) throw new Error("FEN must contain eight ranks");

    return ranks.map(rank => {
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
