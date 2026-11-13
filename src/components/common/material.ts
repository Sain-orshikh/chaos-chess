import { pieceValue } from "../utils/pieces";
import type { Board, Color, Ruleset } from "../utils/types";

// Display values deliberately use the familiar 1/3/3/5/9 scale in Classic.
// The engine's more precise evaluation weights remain separate.
const classicValues = [0, 1, 3, 3, 5, 5, 9, 0];
export function materialBalance(board: Board, ruleset: Ruleset) {
    const surplus = Array<number>(8).fill(0);
    let whiteAdvantage = 0;
    for (const piece of board) {
        if (!piece) continue;
        const id = Math.abs(piece);
        const sign = piece > 0 ? 1 : -1;
        whiteAdvantage += sign * (ruleset === "normal" ? classicValues[id] : Math.abs(pieceValue(piece, ruleset)) / 100);
        // Rook rotation changes form, not material or captured-piece balance.
        surplus[id === 5 ? 4 : id] += sign;
    }
    return { whiteAdvantage, surplus };
}
export function materialForSide(balance: ReturnType<typeof materialBalance>, color: Color) {
    const sign = color === "white" ? 1 : -1;
    return { advantage: balance.whiteAdvantage * sign,
        pieces: balance.surplus.flatMap((count, id) => id === 7 ? [] : Array<number>(Math.max(0, count * sign)).fill(-sign * id)) };
}
