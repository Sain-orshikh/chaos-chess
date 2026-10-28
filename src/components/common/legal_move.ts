import { offsetsS, offsetsD } from "./types";
import type { BasicMove, Board, Color } from "./types";
import { isKingSafe } from "./king_safety";
import { applyMove } from "./apply_move";

export default function LegalMoveGenerate(board: Board, from: [number, number]) {
    const [row, col] = from
    const piece = board[row][col]
    const moves: BasicMove[] = []

    if (!piece) return moves

    const [color, pieceType] = piece.split("-")
    const origin = row * 8 + col


    function genStraight(range: number) {

        //north, south, west, east
        const to_wall = [row, 7-row, col, 7-col]

        for (let direction=0; direction<4; direction++){
            const limit = Math.min(range, to_wall[direction])
            for (let step=1; step <= limit; step++){
                const to = origin + offsetsS[direction] * step
                const target = board[Math.floor(to / 8)][to % 8]

                if (target !== null){
                    const targetColor = target.split("-")
                    if (targetColor[0] !== color){
                        moves.push({from: origin, to, kind: "c"})
                    }

                    break

                }

                moves.push({from: origin, to, kind: "m"})
            }
        }
    }

    function genDiagonal(range: number) {

        const diagonalWalls = [
            Math.min(row, col),         // Northwest
            Math.min(row, 7 - col),     // Northeast
            Math.min(7 - row, col),     // Southwest
            Math.min(7 - row, 7 - col), // Southeast
        ];

        for (let direction=0; direction<4; direction++){
            const limit = Math.min(range, diagonalWalls[direction])
            for (let step=1; step <= limit; step++){
                const to = origin + offsetsD[direction] * step
                const target = board[Math.floor(to / 8)][to % 8]

                if (target !== null){
                    const targetColor = target.split("-")
                    if (targetColor[0] !== color){
                        moves.push({from: origin, to, kind: "c"})
                    }

                    break

                }

                moves.push({from: origin, to, kind: "m"})
            }
        }
    }

    function genHorse() {
        const horseSteps = [
            [ 2,  1],
            [-1,  2],
            [-2, -1],
            [ 1, -2],
            [-2,  1],
            [-1, -2],
            [ 2, -1],
            [ 1,  2],
        ] as const;

        for (const [dr, dc] of horseSteps){
            const nextRow = row + dr
            const nextCol = col + dc
            if(
                nextRow<0 || nextRow >= 8 ||
                nextCol<0 || nextCol >= 8
            ) {
                continue
            }
            const target = board[nextRow][nextCol]

            if (target !== null && target.split("-")[0] === color){
                continue
            }

            moves.push({from: origin, to: nextRow * 8 + nextCol, kind: target === null ? "m" : "c"})
        }
    }

    function genCheckers() {
        const diagonals = [
            [-1, -1],
            [-1,  1],
            [ 1, -1],
            [ 1,  1],
        ] as const;

        function onBoard(r: number, c: number) {
            return r >= 0 && r < 8 && c >= 0 && c < 8;
        }

        for (const [dr, dc] of diagonals) {
            const nextRow = row + dr;
            const nextCol = col + dc;

            if (!onBoard(nextRow, nextCol)) continue;

            const target = board[nextRow][nextCol];

            if (target === null) {
                moves.push({
                    from: origin,
                    to: nextRow * 8 + nextCol,
                    kind: "m",
                });
                continue;
            }

            const landingRow = row + dr * 2;
            const landingCol = col + dc * 2;

            if (!onBoard(landingRow, landingCol)) continue;
            if (board[landingRow][landingCol] !== null) continue;

            moves.push({
                from: origin,
                to: landingRow * 8 + landingCol,
                // Friendly jumps are quiet moves; only enemies are removed.
                kind: target.split("-")[0] === color ? "m" : "ch",
            });
        }
    }

    function genPawn() {
        const forward = color === "white" ? -1 : 1;
        const nextRow = row + forward;

        if (nextRow < 0 || nextRow >= 8) return;

        // Move diagonally into empty squares.
        for (const dc of [-1, 1]) {
            const nextCol = col + dc;

            if (nextCol < 0 || nextCol >= 8) continue;

            if (board[nextRow][nextCol] === null) {
                moves.push({
                    from: origin,
                    to: nextRow * 8 + nextCol,
                    kind: "m",
                });
            }
        }

        // Capture directly ahead.
        const target = board[nextRow][col];

        if (target !== null && target.split("-")[0] !== color) {
            moves.push({
                from: origin,
                to: nextRow * 8 + col,
                kind: "c",
            });
        }
    }

    switch(pieceType){
        case "queen":
            genStraight(7)
            genHorse()
            break
        case "knight":
            genStraight(2)
            genDiagonal(2)
            break
        case "bishop":
            genCheckers()
            break
        case "king":
            genStraight(1)
            genDiagonal(1)
            break
        case "pawn":
            genPawn()
            break
        case "rook":
            genStraight(7)
            moves.push({from: origin, to: origin, kind: "rotate", piece: "diagonalrook"})
            break
        case "diagonalrook":
            genDiagonal(7)
            moves.push({from: origin, to: origin, kind: "rotate", piece: "rook"})
            break
    }

    return moves.filter((move) => {
        const toRow = Math.floor(move.to / 8);
        const toCol = move.to % 8;
        if (move.kind !== "rotate") {
            // Kings are checked/checkmated rather than captured.
            if (board[toRow][toCol]?.split("-")[1] === "king") return false;

            if (move.kind === "ch") {
                const capturedRow = (row + toRow) / 2;
                const capturedCol = (col + toCol) / 2;
                if (board[capturedRow][capturedCol]?.split("-")[1] === "king") return false;
            }
        }

        return isKingSafe(applyMove(board, move), color as Color);
    })

}
