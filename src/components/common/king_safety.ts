import type { Board, Color } from "./types";

const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
const straight = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const horseSteps = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
] as const;

function onBoard(row: number, col: number) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

/** Checks capture patterns directly, without recursively generating legal moves. */
export function isKingSafe(board: Board, color: Color): boolean {
    let kingRow = -1;
    let kingCol = -1;

    for (let row = 0; row < 8; row++) {
        const col = board[row].indexOf(`${color}-king`);
        if (col !== -1) {
            kingRow = row;
            kingCol = col;
            break;
        }
    }

    if (kingRow === -1) return false;

    const enemy = color === "white" ? "black" : "white";

    // Custom queens have ordinary horse jumps.
    for (const [dr, dc] of horseSteps) {
        const row = kingRow + dr;
        const col = kingCol + dc;
        if (onBoard(row, col) && board[row][col] === `${enemy}-queen`) {
            return false;
        }
    }

    // Custom pawns capture straight forward, not diagonally.
    const enemyForward = enemy === "white" ? -1 : 1;
    const pawnRow = kingRow - enemyForward;
    if (onBoard(pawnRow, kingCol) && board[pawnRow][kingCol] === `${enemy}-pawn`) {
        return false;
    }

    // A checkers bishop needs an empty landing square beyond the king.
    for (const [dr, dc] of diagonals) {
        const row = kingRow + dr;
        const col = kingCol + dc;
        const landingRow = kingRow - dr;
        const landingCol = kingCol - dc;
        if (
            onBoard(row, col) && onBoard(landingRow, landingCol) &&
            board[row][col] === `${enemy}-bishop` &&
            board[landingRow][landingCol] === null
        ) {
            return false;
        }
    }

    for (const directions of [straight, diagonals]) {
        const diagonal = directions === diagonals;
        for (const [dr, dc] of directions) {
            for (let distance = 1; distance <= 7; distance++) {
                const row = kingRow + dr * distance;
                const col = kingCol + dc * distance;
                if (!onBoard(row, col)) break;

                const target = board[row][col];
                if (target === null) continue;

                const [targetColor, type] = target.split("-");
                if (targetColor === enemy && (
                    (diagonal && type === "diagonalrook") ||
                    (!diagonal && (type === "rook" || type === "queen")) ||
                    (type === "knight" && distance <= 2) ||
                    (type === "king" && distance === 1)
                )) {
                    return false;
                }

                // Every occupied square blocks all pieces behind it.
                break;
            }
        }
    }

    return true;
}
