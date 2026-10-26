'use client';

import Piece from "./piece";
import { useState, useEffect } from "react";

export default function Board() {
    const STARTING_FEN =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    type PieceName = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
    type Color = "white" | "black";

    const pieceNames: Record<string, PieceName> = {
        k: "king",
        q: "queen",
        r: "rook",
        b: "bishop",
        n: "knight",
        p: "pawn",
    };

    function parseFen(fen: string): (string | null)[][] {
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

    const [board, setBoard] = useState(parseFen(STARTING_FEN));
    const [inMove, setinMove] = useState(false);
    const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);

    type Square = [number, number];

    const [lastMove, setLastMove] = useState<{
        from: Square;
        to: Square;
    } | null>(null);

    const [carriedPiece, setCarriedPiece] = useState<{
        from: Square;
        piece: string;
    } | null>(null);

    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!carriedPiece) return;

        function followPointer(event: PointerEvent) {
            setMousePosition({
                x: event.clientX,
                y: event.clientY,
            });
        }

        window.addEventListener("pointermove", followPointer);

        return () => {
            window.removeEventListener("pointermove", followPointer);
        };
    }, [carriedPiece]);

    function handleSquareClick(rowIndex: number, colIndex: number) {

        const clickedPiece = board[rowIndex][colIndex];
        if (selectedSquare === null) {
            if (clickedPiece) {
                setSelectedSquare([rowIndex, colIndex]);
                setCarriedPiece({
                    from: [rowIndex, colIndex],
                    piece: clickedPiece
                });
                setinMove(true);
            }
            return;
        }

        const [fromRow, fromCol] = selectedSquare;

        if (fromRow === rowIndex && fromCol === colIndex) {
            setCarriedPiece(null);
            setSelectedSquare(null);
            setinMove(false);
            return;
        }

        setBoard((prevBoard) => {
            const newBoard = prevBoard.map((row) => [...row]);

            newBoard[rowIndex][colIndex] = newBoard[fromRow][fromCol];
            newBoard[fromRow][fromCol] = null;

            return newBoard;
        });

        setLastMove({
            from: [fromRow, fromCol],
            to: [rowIndex, colIndex],
        });

        setSelectedSquare(null);
        setCarriedPiece(null);
        setinMove(false);

    }

    return (
        <div className="bg-gray-200 w-fit mx-auto my-auto border-gray-500 border-12">
            {board.map((row, rowIndex) => (
                <div key={rowIndex} className="flex">
                    {row.map((piece, colIndex) => {
                        const isBlack = (rowIndex + colIndex) % 2 === 0;
                        function matches(square: Square | null | undefined) {
                            if (square?.[0] === rowIndex && square?.[1] === colIndex) {
                                return true;
                            }
                            return false;
                        }
                        return (
                            <div
                                key={colIndex}
                                className={`relative w-[60px] h-[60px] flex items-center justify-center ${
                                    isBlack ? "bg-purple-300" : "bg-yellow-50"
                                }`}
                                onClick={(event) => {setMousePosition({ x: event.clientX, y: event.clientY }); handleSquareClick(rowIndex, colIndex)}}
                            >
                                {matches(selectedSquare) || matches(lastMove?.from) || matches(lastMove?.to) ? 
                                <div className="absolute inset-0 bg-yellow-400/40 pointer-events-none"></div>    
                                : null}
                                {piece && !matches(carriedPiece?.from) && Piece(
                                    piece.split("-")[1] as PieceName,
                                    piece.split("-")[0] as Color
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}
            {carriedPiece && (
                <div
                    className="fixed z-50 w-[60px] h-[60px] pointer-events-none"
                    style={{
                        left: mousePosition.x,
                        top: mousePosition.y,
                        transform: "translate(-50%, -50%)",
                    }}
                >
                    {Piece(
                        carriedPiece.piece.split("-")[1] as PieceName,
                        carriedPiece.piece.split("-")[0] as Color
                    )}
                </div>
            )}
        </div>
    );
}