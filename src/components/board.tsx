'use client';

import { useEffect, useMemo, useReducer, useState } from "react";
import Piece from "./piece";
import type { PieceName, Color } from "./common/types";
import { parseFen } from "./common/fen_parcer";
import LegalMoveGenerate from "./common/legal_move";
import { createGame, gameReducer } from "./common/game_state";

const STARTING_FEN =
    "rbnqknbr/pppppppp/8/8/8/8/PPPPPPPP/RBNQKNBR w KQkq - 0 1";

export default function Board() {
    const [game, dispatch] = useReducer(gameReducer, STARTING_FEN, (fen) => createGame(parseFen(fen)));
    const { board, turn, selectedSquare, lastMove, status } = game;
    const gameOver = status.kind === "checkmate" || status.kind === "stalemate";
    const playerName = turn === "white" ? "White" : "Black";
    const statusText = status.kind === "checkmate"
        ? `Checkmate — ${status.winner === "white" ? "White" : "Black"} wins`
        : status.kind === "stalemate"
            ? "Stalemate — draw"
            : `${playerName} to move${status.kind === "check" ? " — in check" : ""}`;
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const carriedPiece = selectedSquare ? board[selectedSquare[0]][selectedSquare[1]] : null;
    const legalMoves = useMemo(
        () => selectedSquare ? LegalMoveGenerate(board, selectedSquare) : [],
        [board, selectedSquare],
    );
    const rotation = legalMoves.find((move) => move.kind === "rotate");

    useEffect(() => {
        if (!carriedPiece) return;

        function followPointer(event: PointerEvent) {
            setMousePosition({ x: event.clientX, y: event.clientY });
        }

        window.addEventListener("pointermove", followPointer);
        return () => window.removeEventListener("pointermove", followPointer);
    }, [carriedPiece]);

    return (
        <div className="w-fit mx-auto my-auto">
            <div className="mb-3 flex min-h-10 items-center justify-between gap-4">
                <p role="status" className="font-semibold">
                    {statusText}
                </p>
                {rotation && (
                    <button
                        type="button"
                        className="rounded bg-purple-700 px-3 py-2 text-sm text-white"
                        onClick={() => dispatch({ type: "rotate" })}
                    >
                        Switch rook to {rotation.piece === "diagonalrook" ? "diagonal" : "straight"}
                    </button>
                )}
                {gameOver && (
                    <button
                        type="button"
                        className="rounded bg-purple-700 px-3 py-2 text-sm text-white"
                        onClick={() => dispatch({ type: "restart", board: parseFen(STARTING_FEN) })}
                    >
                        New game
                    </button>
                )}
            </div>
            <div className="border-gray-500 border-12 bg-gray-200">
                {board.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex">
                        {row.map((piece, colIndex) => {
                            const square = rowIndex * 8 + colIndex;
                            const selected = selectedSquare?.[0] === rowIndex && selectedSquare?.[1] === colIndex;
                            const legal = legalMoves.find((move) => move.kind !== "rotate" && move.to === square);
                            const highlighted = selected || lastMove?.from === square || lastMove?.to === square;
                            const squareName = `${"abcdefgh"[colIndex]}${8 - rowIndex}`;

                            return (
                                <button
                                    type="button"
                                    key={colIndex}
                                    disabled={gameOver}
                                    aria-label={`${squareName}${piece ? ` ${piece}` : " empty"}${legal ? " legal destination" : ""}`}
                                    aria-pressed={selected}
                                    className={`relative w-[60px] h-[60px] shrink-0 flex items-center justify-center p-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-purple-700 ${
                                        (rowIndex + colIndex) % 2 === 0 ? "bg-purple-300" : "bg-yellow-50"
                                    }`}
                                    onClick={(event) => {
                                        setMousePosition({ x: event.clientX, y: event.clientY });
                                        dispatch({ type: "click", square: [rowIndex, colIndex] });
                                    }}
                                >
                                    {highlighted && <span className="absolute inset-0 bg-yellow-400/40 pointer-events-none" />}
                                    {piece && !selected && Piece(
                                        piece.split("-")[1] as PieceName,
                                        piece.split("-")[0] as Color,
                                    )}
                                    {legal && (
                                        <span className={`absolute z-10 pointer-events-none ${
                                            legal.kind === "m"
                                                ? "h-4 w-4 rounded-full bg-purple-900/35"
                                                : "inset-1 rounded-full border-4 border-purple-800/60"
                                        }`} />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {gameOver ? "Game over. Start a new game to play again." : "Click the starting square to put a piece back without using your turn."}
            </p>
            {carriedPiece && (
                <div
                    className="fixed z-50 w-[60px] h-[60px] pointer-events-none"
                    style={{ left: mousePosition.x, top: mousePosition.y, transform: "translate(-50%, -50%)" }}
                >
                    {Piece(
                        carriedPiece.split("-")[1] as PieceName,
                        carriedPiece.split("-")[0] as Color,
                    )}
                </div>
            )}
        </div>
    );
}
