import { pieceDefinitions, pieceIds } from "./pieces";
import type { PieceName } from "./types";

// A pawn is 100. Any two static position bonuses differ by LESS than 80,
// so positional preferences alone cannot outweigh even a one-pawn material gap.
export const POSITION_BONUS_LIMIT = 40;
export type PieceSquareTable = { opening: number[]; endgame: number[] };
export type PieceSquareTables = Record<number, PieceSquareTable>;

/** Keep the correction small without a hard plateau that would erase endgame progress. */
export function boundedPositionBonus(score: number): number {
    return POSITION_BONUS_LIMIT * score / (POSITION_BONUS_LIMIT + Math.abs(score));
}

export const STARTING_PHASE_MATERIAL = 2 * (
    2 * pieceDefinitions.knight.value + 2 * pieceDefinitions.bishop.value +
    2 * pieceDefinitions.rook.value + pieceDefinitions.queen.value
);
/** Both armies determine how crowded the board is. Pawn advancement does not alter phase. */
export function openingWeight(nonPawnMaterial: number): number {
    return Math.max(0, Math.min(1, nonPawnMaterial / STARTING_PHASE_MATERIAL));
}

/** Tables use White's view (row 7 = home). Black mirrors only the rank. */
export function createPieceSquareTables(seed = 0): PieceSquareTables {
    let randomState = seed >>> 0;
    function openingNoise(): number {
        if (seed === 0) return 0; // Reproducible engine-lab comparisons by default.
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return (randomState / 0x100000000 - 0.5) * 0.5; // At most a quarter point per piece.
    }
    const tables: PieceSquareTables = {};
    for (const name of ["pawn", "knight", "bishop", "rook", "queen", "king"] as const satisfies readonly PieceName[]) {
        const table: PieceSquareTable = { opening: [], endgame: [] };
        for (let square = 0; square < 64; square++) {
            const row = Math.floor(square / 8), col = square % 8;
            const center = 3.5 - Math.max(Math.abs(row - 3.5), Math.abs(col - 3.5)); // 0–3.
            const advance = Math.max(0, Math.min(5, 6 - row));
            let opening = 0, endgame = 0;
            switch (name) {
                case "pawn": opening = advance + center * 0.5; endgame = advance * 2; break;
                case "knight": opening = (row < 7 ? 4 : 0) + center * 2; endgame = center * 2; break;
                case "bishop": opening = (row < 7 ? 4 : 0) + center * 1.5; endgame = center * 1.5; break;
                case "rook": opening = (row < 7 ? 2 : 0) + (row === 1 ? 3 : 0); endgame = advance * 0.5 + center * 0.5; break;
                case "queen": opening = -advance * 1.5; endgame = center * 1.5; break;
                case "king":
                    opening = -((7 - row) + Math.min(Math.abs(col - 2), Math.abs(col - 6))) * 1.5;
                    endgame = center;
                    break;
            }
            table.opening.push(opening + openingNoise());
            table.endgame.push(endgame);
        }
        tables[pieceIds[name]] = table;
    }
    // Switching rook form at the same square must never create a positional reward.
    tables[pieceIds.diagonalrook] = tables[pieceIds.rook];
    return tables;
}

export const defaultPieceSquareTables = createPieceSquareTables();
