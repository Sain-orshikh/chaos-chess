'use client';

import Image from "next/image";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import Piece, { BoardPiece } from "./piece";
import { pieceColor, pieceDefinition, pieceDefinitions } from "./utils/pieces";
import GameResultModal from "./game-result-modal";
import OnlineGameFinalization from "./online-game-finalization";
import GameActions from "./game-actions";
import PlayerAvatar from "./player-avatar";
import type { BasicMove, Board as BoardState, Color, Ruleset } from "./utils/types";
import MerlinPanel from "./merlin-panel";
import MerlinBadgeResult from "./merlin-badge-result";
import KestrelPanel from "./kestrel-panel";
import KestrelBadgeResult from "./kestrel-badge-result";
import BotPanel from "./bot-panel";
import BadgeStrip from './badge-strip';
import RookeBadgeResult from './rooke-badge-result';
import { parseFen } from "./utils/fen_parcer";
import { legalMovesForPiece as LegalMoveGenerate } from "./common/rules";
import { createGame, gameReducer, promotionPieces, isGameOver } from "./common/game_state";

import type { GameState, GameAction } from "./common/game_state";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Props = {
    testMode?: boolean; orientation?: Color; playerName?: string; bot?: boolean; botId?: "rooke" | "kestrel" | "merlin"; ruleset?: Ruleset;
    game?: GameState; onAction?: Dispatch<GameAction>; locked?: boolean; analysis?: boolean;
    highlightedMove?: BasicMove | null; onSetup?: () => void; evaluationSeed?: number;
    onlineGameId?: string;
    playerImage?: string;
    online?: { color: Color; players: Record<Color, { name: string; image?: string; rating?: number; equippedBadges?: string[] }>; controls: ReactNode;
        onRematch: () => void; rematchLabel: string; rematchDisabled?: boolean; live?: boolean; clocks?: Record<Color, string>; ratingSummary?: ReactNode };

};

export default function Board({ testMode = false, orientation = "white", playerName = "Anonymous", bot = false, botId = "rooke", ruleset: initialRuleset = "chaos", game: controlledGame, onAction, locked = false, analysis = false, highlightedMove, onSetup, evaluationSeed, onlineGameId, playerImage, online }: Props) {
    const [localGame, localDispatch] = useReducer(gameReducer, STARTING_FEN, (fen) => createGame(parseFen(fen), "white", undefined, initialRuleset));
    const game = controlledGame ?? localGame;
    const dispatch = onAction ?? localDispatch;
    const ruleset = game.ruleset;
    const { board, castling, standard, turn, selectedSquare, lastMove, status, pendingPromotion } = game;
    const gameOver = isGameOver(status);
    const botName = botId === "merlin" ? "Merlin" : botId === "kestrel" ? "Kestrel" : "Rooke";
    const botTurn = bot && turn !== orientation;
    const [gameNumber, setGameNumber] = useState(0);
    const acceptBotMove = useCallback((move: BasicMove, expectedBoard: BoardState, turn: Color) => {
        dispatch({ type: "engine-move", move, expectedBoard, turn });
    }, [dispatch]);
    const turnName = turn === "white" ? "White" : "Black";
    const statusText = pendingPromotion ? `${turnName}: choose a promotion` : status.kind === "checkmate"
        ? `Checkmate — ${status.winner === "white" ? "White" : "Black"} wins`
        : status.kind === "resigned" ? `${status.winner === "white" ? "White" : "Black"} wins by resignation`
        : status.kind === "timeout" || status.kind === "disconnect" ? `${status.winner === "white" ? "White" : "Black"} wins by ${status.kind}`
        : status.kind === "draw" ? status.reason === "abandoned" ? "Match abandoned — no rating change" : status.reason === "timeout" ? "Draw — opponent cannot checkmate" : status.reason === "agreement" ? "Draw by agreement" : status.reason === "insufficient-material" ? "Draw — insufficient material" : "Draw — 75 moves without a pawn move or capture" : status.kind === "stalemate" ? "Stalemate — draw" : `${turnName} to move${status.kind === "check" ? " — in check" : ""}`;
    const [pointer, setPointer] = useState({ x: 0, y: 0, mouse: false });
    const [movingRook, setMovingRook] = useState<number | null>(null);
    const [resultDismissed, setResultDismissed] = useState(false);
    const rookChoice = useRef<HTMLDivElement>(null);
    const promotionChoice = useRef<HTMLDivElement>(null);
    const statusLabel = useRef<HTMLParagraphElement>(null);
    const wasPromoting = useRef(false);
    const selectedPiece = selectedSquare ? board[selectedSquare[0] * 8 + selectedSquare[1]] : 0;
    const legalMoves = useMemo(() => selectedSquare ? LegalMoveGenerate(board, selectedSquare[0] * 8 + selectedSquare[1], castling, standard) : [], [board, selectedSquare, castling, standard]);
    const rotation = legalMoves.find(move => move.kind === "rotate");
    const origin = selectedSquare ? selectedSquare[0] * 8 + selectedSquare[1] : null;
    const selectedDefinition = pieceDefinition(selectedPiece);
    const rotationDefinition = selectedDefinition?.rotatesTo ? pieceDefinitions[selectedDefinition.rotatesTo] : null;
    const showRookChoice = ruleset === "chaos" && !!selectedSquare && !!rotationDefinition && movingRook !== origin;
    const carriedPiece = pointer.mouse && !showRookChoice ? selectedPiece : null;
    useEffect(() => { if (showRookChoice) rookChoice.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [showRookChoice]);
    useEffect(() => {
        if (pendingPromotion) promotionChoice.current?.querySelector<HTMLButtonElement>("button")?.focus();
        else if (wasPromoting.current) statusLabel.current?.focus();
        wasPromoting.current = pendingPromotion !== null;
    }, [pendingPromotion]);
    useEffect(() => {
        if (!carriedPiece) return;
        function followPointer(event: PointerEvent) { setPointer({ x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" }); }
        window.addEventListener("pointermove", followPointer);
        return () => window.removeEventListener("pointermove", followPointer);
    }, [carriedPiece]);
    const topColor = orientation === "white" ? "black" : "white";
    const visualRow = selectedSquare ? orientation === "black" ? 7 - selectedSquare[0] : selectedSquare[0] : 0;
    const visualCol = selectedSquare ? orientation === "black" ? 7 - selectedSquare[1] : selectedSquare[1] : 0;
    const promotionRow = pendingPromotion ? orientation === "black" ? 7 - pendingPromotion.square[0] : pendingPromotion.square[0] : 0;
    const promotionCol = pendingPromotion ? orientation === "black" ? 7 - pendingPromotion.square[1] : pendingPromotion.square[1] : 0;
    function focusStatus() { requestAnimationFrame(() => statusLabel.current?.focus()); }
    function restart() {
        setGameNumber(number => number + 1);
        setMovingRook(null);
        setResultDismissed(false);
        dispatch({ type: "restart", board: parseFen(STARTING_FEN) });
        focusStatus();
    }
    const shownMove = highlightedMove ?? lastMove;
    const ActiveBotPanel = botId === "merlin" ? MerlinPanel : botId === "kestrel" ? KestrelPanel : BotPanel;
    return <div><div className="game-board" onKeyDown={event => {
        if (event.key === "Escape" && selectedSquare) { event.stopPropagation(); dispatch({ type: "click", square: selectedSquare }); setMovingRook(null); }
    }}>
        <div className="board-player">{online ? <PlayerAvatar name={online.players[topColor].name} src={online.players[topColor].image} /> : bot ? <Image src={botId === "merlin" ? "/brand-merlin.svg" : botId === "kestrel" ? "/brand-kestrel.svg" : "/brand-rooke.svg"} width={24} height={32} alt="" className="rooke-avatar" /> : <PlayerAvatar name="Player 2" />}<strong>{online ? online.players[topColor].name : bot ? <>{botName} <span className="bot-rating" title="Approximate Classic Elo">({botId === "merlin" ? 2250 : botId === "kestrel" ? 1850 : 1450})</span></> : analysis ? topColor === "white" ? "White" : "Black" : "Player 2"}{online && <small className="player-rating">{online.players[topColor].rating}</small>}</strong><span>{topColor === "black" ? "Black" : "White"} pieces</span>{online && <BadgeStrip ids={online.players[topColor].equippedBadges} />}{online && <time className={`player-clock${turn === topColor && !gameOver ? " active" : ""}`} aria-label={`${topColor} clock`}>{online.clocks?.[topColor] ?? "5:00"}</time>}</div>
        <div className="board-status"><p ref={statusLabel} tabIndex={-1} role="status" aria-live="polite"><i className={`turn-dot ${turn}`} />{statusText}</p><span>{online ? online.live ? "Online match" : "Online match preview" : analysis ? "Analysis board" : bot ? `vs ${botName}` : "Local 1v1"}</span></div>
        <div className="board-frame"><div className="chess-grid" aria-label={ruleset === "chaos" ? "Havoc Chess board" : "Classic Chess board"} inert={pendingPromotion !== null}>
            {Array.from({ length: 64 }, (_, index) => {
                const visualR = Math.floor(index / 8), visualC = index % 8;
                const row = orientation === "black" ? 7 - visualR : visualR, col = orientation === "black" ? 7 - visualC : visualC;
                const square = row * 8 + col, piece = board[square], selected = origin === square;
                const legal = !showRookChoice && legalMoves.find(move => move.kind !== "rotate" && move.to === square);
                const latest = shownMove?.from === square || shownMove?.to === square || (shownMove?.kind === "castle" && (shownMove.rookFrom === square || shownMove.rookTo === square));
                return <button type="button" key={square} disabled={locked || gameOver || pendingPromotion !== null || botTurn}
                    aria-label={`${"abcdefgh"[col]}${8 - row}${piece ? ` ${pieceColor(piece)} ${pieceDefinition(piece)!.label}` : " empty"}${legal ? legal.kind !== "rotate" && legal.promotion ? " promotion destination" : " legal destination" : ""}`}
                    aria-pressed={selected} className={`board-square ${(row + col) % 2 ? "dark" : "light"}${selected ? " selected" : latest ? " latest" : ""}`}
                    onPointerDown={event => setPointer({ x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" })}
                    onClick={() => { if (!selectedSquare || selected) setMovingRook(null); dispatch({ type: "click", square: [row, col] }); }}>
                    {visualC === 0 && <span className="coordinate rank">{8 - row}</span>}
                    {visualR === 7 && <span className="coordinate file">{"abcdefgh"[col]}</span>}
                    {piece !== 0 && !(selected && carriedPiece) && <BoardPiece code={piece} />}
                    {legal && <span className={`legal-marker ${legal.kind === "m" ? "quiet" : "capture"}`} />}
                </button>;
            })}
        </div>
        {showRookChoice && <div ref={rookChoice} className="rook-choice" role="group" aria-label="Choose rook action" style={{ left: `clamp(110px, ${(visualCol + .5) * 12.5}%, calc(100% - 110px))`, top: visualRow < 4 ? `${(visualRow + 1) * 12.5}%` : undefined, bottom: visualRow >= 4 ? `${(8 - visualRow) * 12.5}%` : undefined }}>
            <p>Choose an action</p><div>
                <button type="button" disabled={locked || !legalMoves.some(move => move.kind !== "rotate")} onClick={() => { setMovingRook(origin); setPointer(p => ({ ...p, mouse: false })); }}><BoardPiece code={selectedPiece} /><span>Move</span></button>
                <button type="button" disabled={locked || !rotation} title={!rotation ? "Switching would leave your king in check" : "Uses one turn"} onClick={() => { dispatch({ type: "rotate" }); setMovingRook(null); }}>{Piece(selectedDefinition!.rotatesTo!, turn)}<span>Switch to {rotationDefinition!.label}</span></button>
            </div><small>Switching uses one turn.</small>
        </div>}
        {pendingPromotion && <div ref={promotionChoice} className="promotion-choice" role="group" aria-labelledby="promotion-title"
            style={{ left: `clamp(124px, ${(promotionCol + .5) * 12.5}%, calc(100% - 124px))`, top: promotionRow < 4 ? `${(promotionRow + 1) * 12.5}%` : undefined, bottom: promotionRow >= 4 ? `${(8 - promotionRow) * 12.5}%` : undefined }}
            onKeyDown={event => {
                if (event.key === "Escape") event.stopPropagation();
                if (event.key !== "Tab") return;
                const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
                const index = choices.indexOf(document.activeElement as HTMLButtonElement);
                event.preventDefault();
                choices[(index + (event.shiftKey ? choices.length - 1 : 1)) % choices.length]?.focus();
            }}>
            <p id="promotion-title">Promote your pawn</p>
            <div>{promotionPieces.map(piece => <button type="button" key={piece} disabled={locked} aria-label={`Promote to ${piece}`} onClick={() => dispatch({ type: "promote", piece })}>
                {Piece(piece, pendingPromotion.color)}<span>{piece[0].toUpperCase() + piece.slice(1)}</span>
            </button>)}</div>
        </div>}
        </div>
        <div className="board-player bottom"><PlayerAvatar name={online ? online.players[orientation].name : playerName} src={online ? online.players[orientation].image : playerImage} /><strong>{online ? online.players[orientation].name : analysis ? orientation === "white" ? "White" : "Black" : playerName}{online && <small className="player-rating">{online.players[orientation].rating}</small>}</strong><span>{orientation === "white" ? "White" : "Black"} pieces</span>{online && <BadgeStrip ids={online.players[orientation].equippedBadges} />}{online && <time className={`player-clock${turn === orientation && !gameOver ? " active" : ""}`} aria-label={`${orientation} clock`}>{online.clocks?.[orientation] ?? "5:00"}</time>}</div>
        {!analysis && !online && game.drawOffer && <div className="draw-offer" role="status"><p>{game.drawOffer === "white" ? "White" : "Black"} offers a draw. {game.drawOffer === "white" ? "Black" : "White"}, accept?</p><div>
            <button className="quiet-button" onClick={() => dispatch({ type: "respond-draw", color: game.drawOffer === "white" ? "black" : "white", accept: true })}>Accept draw</button>
            <button className="quiet-button" onClick={() => dispatch({ type: "respond-draw", color: game.drawOffer === "white" ? "black" : "white", accept: false })}>Decline draw</button>
        </div></div>}
        <div className="board-bottom"><p>{pendingPromotion ? "Choose a piece to finish your turn." : gameOver ? "Game over." : online && turn !== online.color ? "Waiting for your opponent’s move." : botTurn ? `${botName} is choosing a move.` : analysis ? "Play either side, or play an engine suggestion." : "Select a piece, then its destination."}</p>
            {online?.controls}
            {!analysis && !online && <GameActions finished={gameOver} drawDisabled={pendingPromotion !== null || game.drawOffer !== null}
                onResign={() => dispatch({ type: "resign", color: bot ? orientation : turn })} onOfferDraw={bot ? undefined : () => dispatch({ type: "offer-draw", color: turn })} onRestart={restart} onSetup={onSetup}
                onViewResult={gameOver && resultDismissed ? () => setResultDismissed(false) : undefined} />}
        </div>
        {!analysis && isGameOver(status) && !resultDismissed && <GameResultModal
            status={status} playerColor={online?.color ?? orientation} playerName={online ? online.players[online.color].name : playerName} opponentName={online ? online.players[online.color === "white" ? "black" : "white"].name : bot ? botName : analysis ? topColor === "white" ? "White" : "Black" : "Player 2"}
            onPlayAgain={online?.onRematch ?? restart}
            playAgainLabel={online?.rematchLabel} playAgainDisabled={online?.rematchDisabled} matchLabel={online ? online.live ? "Online match" : "Online match preview" : undefined}
            onViewBoard={() => { setResultDismissed(true); focusStatus(); }}
            ratingSummary={bot && "winner" in status && status.winner === orientation ? botId === "merlin" ? <MerlinBadgeResult key={gameNumber} /> : botId === "kestrel" ? <KestrelBadgeResult key={gameNumber} /> : <RookeBadgeResult key={gameNumber} /> : online?.live ? online.ratingSummary : online ? <p className="result-unrated">Preview only · Ratings are unchanged</p> : onlineGameId && !bot ? <OnlineGameFinalization key={onlineGameId} gameId={onlineGameId} /> : undefined}
        />}
        {!!carriedPiece && <div className="carried-piece" style={{ left: pointer.x, top: pointer.y }}>{<BoardPiece code={carriedPiece} />}</div>}
    </div>{bot && <ActiveBotPanel testMode={testMode} key={gameNumber} evaluationSeed={evaluationSeed} board={board} halfmoveClock={game.halfmoveClock} castling={castling} standard={standard} turn={turn} active={botTurn && !gameOver && !pendingPromotion} onMove={acceptBotMove} />}</div>;
}
