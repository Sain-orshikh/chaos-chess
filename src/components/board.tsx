'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Piece from "./piece";
import Icon from "./icon";
import type { PieceName, Color } from "./common/types";
import { parseFen } from "./common/fen_parcer";
import LegalMoveGenerate from "./common/legal_move";
import { createGame, gameReducer } from "./common/game_state";

const STARTING_FEN = "rbnqknbr/pppppppp/8/8/8/8/PPPPPPPP/RBNQKNBR w KQkq - 0 1";

export default function Board({ orientation = "white", playerName = "Anonymous" }: { orientation?: Color; playerName?: string }) {
    const [game, dispatch] = useReducer(gameReducer, STARTING_FEN, (fen) => createGame(parseFen(fen)));
    const { board, turn, selectedSquare, lastMove, status } = game;
    const gameOver = status.kind === "checkmate" || status.kind === "stalemate";
    const turnName = turn === "white" ? "White" : "Black";
    const statusText = status.kind === "checkmate"
        ? `Checkmate — ${status.winner === "white" ? "White" : "Black"} wins`
        : status.kind === "stalemate" ? "Stalemate — draw" : `${turnName} to move${status.kind === "check" ? " — in check" : ""}`;
    const [pointer, setPointer] = useState({ x: 0, y: 0, mouse: false });
    const [movingRook, setMovingRook] = useState<number | null>(null);
    const rookChoice = useRef<HTMLDivElement>(null);
    const selectedPiece = selectedSquare ? board[selectedSquare[0]][selectedSquare[1]] : null;
    const legalMoves = useMemo(() => selectedSquare ? LegalMoveGenerate(board, selectedSquare) : [], [board, selectedSquare]);
    const rotation = legalMoves.find(move => move.kind === "rotate");
    const origin = selectedSquare ? selectedSquare[0] * 8 + selectedSquare[1] : null;
    const isRook = selectedPiece?.endsWith("-rook") || selectedPiece?.endsWith("-diagonalrook");
    const showRookChoice = !!selectedSquare && !!isRook && movingRook !== origin;
    const carriedPiece = pointer.mouse && !showRookChoice ? selectedPiece : null;
    useEffect(() => { if (showRookChoice) rookChoice.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [showRookChoice]);
    useEffect(() => {
        if (!carriedPiece) return;
        function followPointer(event: PointerEvent) { setPointer({ x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" }); }
        window.addEventListener("pointermove", followPointer);
        return () => window.removeEventListener("pointermove", followPointer);
    }, [carriedPiece]);
    const topColor = orientation === "white" ? "black" : "white";
    const visualRow = selectedSquare ? orientation === "black" ? 7 - selectedSquare[0] : selectedSquare[0] : 0;
    const visualCol = selectedSquare ? orientation === "black" ? 7 - selectedSquare[1] : selectedSquare[1] : 0;
    function restart() { setMovingRook(null); dispatch({ type: "restart", board: parseFen(STARTING_FEN) }); }
    return <div className="game-board" onKeyDown={event => {
        if (event.key === "Escape" && selectedSquare) { event.stopPropagation(); dispatch({ type: "click", square: selectedSquare }); setMovingRook(null); }
    }}>
        <div className="board-player"><span className={`player-color ${topColor}`} /><strong>Player 2</strong><span>{topColor === "black" ? "Black" : "White"} pieces</span></div>
        <div className="board-status"><p role="status" aria-live="polite"><i className={`turn-dot ${turn}`} />{statusText}</p><span>Local 1v1</span></div>
        <div className="board-frame"><div className="chess-grid" aria-label="Chaos Chess board">
            {Array.from({ length: 64 }, (_, index) => {
                const visualR = Math.floor(index / 8), visualC = index % 8;
                const row = orientation === "black" ? 7 - visualR : visualR, col = orientation === "black" ? 7 - visualC : visualC;
                const piece = board[row][col], square = row * 8 + col, selected = origin === square;
                const legal = !showRookChoice && legalMoves.find(move => move.kind !== "rotate" && move.to === square);
                const latest = lastMove?.from === square || lastMove?.to === square;
                return <button type="button" key={square} disabled={gameOver}
                    aria-label={`${"abcdefgh"[col]}${8 - row}${piece ? ` ${piece.replaceAll("-", " ")}` : " empty"}${legal ? legal.kind === "p" ? " promotion destination" : " legal destination" : ""}`}
                    aria-pressed={selected} className={`board-square ${(row + col) % 2 ? "dark" : "light"}${selected ? " selected" : latest ? " latest" : ""}`}
                    onPointerDown={event => setPointer({ x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" })}
                    onClick={() => { if (!selectedSquare || selected) setMovingRook(null); dispatch({ type: "click", square: [row, col] }); }}>
                    {visualC === 0 && <span className="coordinate rank">{8 - row}</span>}
                    {visualR === 7 && <span className="coordinate file">{"abcdefgh"[col]}</span>}
                    {piece && !(selected && carriedPiece) && Piece(piece.split("-")[1] as PieceName, piece.split("-")[0] as Color)}
                    {legal && <span className={`legal-marker ${legal.kind === "m" || legal.kind === "p" ? "quiet" : "capture"}`} />}
                </button>;
            })}
        </div>
        {showRookChoice && <div ref={rookChoice} className="rook-choice" role="group" aria-label="Choose rook action" style={{ left: `clamp(110px, ${(visualCol + .5) * 12.5}%, calc(100% - 110px))`, top: visualRow < 4 ? `${(visualRow + 1) * 12.5}%` : undefined, bottom: visualRow >= 4 ? `${(8 - visualRow) * 12.5}%` : undefined }}>
            <p>Choose an action</p><div>
                <button type="button" disabled={!legalMoves.some(move => move.kind !== "rotate")} onClick={() => { setMovingRook(origin); setPointer(p => ({ ...p, mouse: false })); }}>{Piece(selectedPiece!.endsWith("-diagonalrook") ? "diagonalrook" : "rook", turn)}<span>Move</span></button>
                <button type="button" disabled={!rotation} title={!rotation ? "Switching would leave your king in check" : "Uses one turn"} onClick={() => { dispatch({ type: "rotate" }); setMovingRook(null); }}>{Piece(selectedPiece!.endsWith("-diagonalrook") ? "rook" : "diagonalrook", turn)}<span>Switch to {selectedPiece!.endsWith("-diagonalrook") ? "+" : "×"}</span></button>
            </div><small>Switching uses one turn.</small>
        </div>}
        </div>
        <div className="board-player bottom"><span className={`player-color ${orientation}`} /><strong>{playerName}</strong><span>{orientation === "white" ? "White" : "Black"} pieces</span></div>
        <div className="board-bottom"><p>{gameOver ? "Game over." : legalMoves.some(move => move.kind === "p") ? "Choose a highlighted promotion square." : "Select a piece, then its destination."}</p><button className="quiet-button" onClick={restart}><Icon name="replay" />{gameOver ? "New game" : "Restart"}</button></div>
        {carriedPiece && <div className="carried-piece" style={{ left: pointer.x, top: pointer.y }}>{Piece(carriedPiece.split("-")[1] as PieceName, carriedPiece.split("-")[0] as Color)}</div>}
    </div>;
}
