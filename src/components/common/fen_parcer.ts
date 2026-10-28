import { pieceNames } from "./types";

export function parseFen(fen: string): (string | null)[][] {
    const position = fen.split(" ")[0];
    const ranks = position.split("/");

    return ranks.map((rank) => {
        const squares: (string | null)[] = [];

        for (const char of rank) {
            if (/[1-8]/.test(char)) {
                for (let i = 0; i < Number(char); i++) {
                    squares.push(null);
                }
            } else {
                const color = char === char.toUpperCase()
                    ? "white"
                    : "black";

                squares.push(`${color}-${pieceNames[char.toLowerCase()]}`);
            }
        }

        return squares;
    });
}