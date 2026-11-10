"use client";

import Link from "next/link";
import LiveMatch from "./live-match";
import { useReducer, useState } from "react";
import Board from "./board";
import GameActions from "./game-actions";
import { useAuth } from "./auth-provider";
import { createGame, gameReducer, isGameOver, type GameAction, type GameState } from "./common/game_state";
import { parseFen } from "./utils/fen_parcer";
import type { Color, Ruleset } from "./utils/types";

const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
type Session = { game: GameState; moves: string[] };
const squareName = (square: number) => `${"abcdefgh"[square % 8]}${8 - Math.floor(square / 8)}`;
function reduceSession(state: Session, action: GameAction): Session {
    if (action.type === "restart") return { game: gameReducer(state.game, action), moves: [] };
    const game = gameReducer(state.game, action);
    if (game === state.game) return state;
    const moved = game.turn !== state.game.turn && game.lastMove;
    return { game, moves: moved ? [...state.moves, `${squareName(game.lastMove!.from)} → ${squareName(game.lastMove!.to)}${action.type === "promote" ? ` = ${action.piece}` : game.lastMove!.kind === "rotate" ? " (switch)" : ""}`] : state.moves };
}

export default function OnlineMatch(props: { ruleset: Ruleset; gameId: string }) {
    return props.gameId === "demo" ? <PreviewMatch {...props} /> : <LiveMatch key={props.gameId} {...props} />;
}
function PreviewMatch({ ruleset, gameId }: { ruleset: Ruleset; gameId: string }) {
    const { user } = useAuth();
    const [{ game, moves }, dispatch] = useReducer(reduceSession, ruleset, rules => ({ game: createGame(parseFen(startingFen), "white", undefined, rules), moves: [] }));
    const [color, setColor] = useState<Color>("white");
    const [flipped, setFlipped] = useState(false);
    const [notice, setNotice] = useState("");
    const [rematch, setRematch] = useState(false);
    const [matchNumber, setMatchNumber] = useState(0);
    const orientation = flipped ? color === "white" ? "black" : "white" : color;
    const players = {
        white: { name: user?.displayName || user?.username || "Alex Morgan", image: user?.profileImg || "/avatar-preview-white.svg", rating: user?.elo ?? 1420 },
        black: { name: "Jamie Chen", image: "/avatar-preview-black.svg", rating: 1458 },
    };
    const finished = isGameOver(game.status);
    const label = ruleset === "chaos" ? "Havoc Chess" : "Classic Chess";
    async function copyLink() {
        try { await navigator.clipboard.writeText(window.location.href); setNotice("Game link copied."); }
        catch { setNotice("Copy the game link from your address bar."); }
    }
    function requestRematch() { setRematch(true); setNotice("Rematch requested. Switch players to accept it in this preview."); }
    function switchPlayer() {
        if (game.selectedSquare) dispatch({ type: "click", square: game.selectedSquare });
        setColor(current => current === "white" ? "black" : "white"); setFlipped(false); setNotice("");
    }
    const [rematchFrom, setRematchFrom] = useState<Color | null>(null);
    function offerRematch() { setRematchFrom(color); requestRematch(); }

    if (gameId !== "demo") return <section className="match-unavailable"><h1>Game unavailable</h1><p>Live game rooms aren’t connected yet.</p><Link className="primary-button" href={`/${ruleset === "chaos" ? "havoc" : "classic"}/demo`}>Open the board preview</Link></section>;
    return <section className="online-match-page">
        <div className="online-preview-note"><div><strong>Try the match experience</strong><p>Moves stay on this page. Clocks are paused, and ratings won’t change.</p></div><button className="quiet-button" onClick={switchPlayer}>Switch player</button></div>
        <div className="online-match-layout">
            <Board key={matchNumber} game={game} onAction={dispatch} ruleset={ruleset} orientation={orientation} locked={game.turn !== color}
                online={{ players, color, controls: <GameActions finished={finished} drawDisabled={!!game.drawOffer || !!game.pendingPromotion}
                    onResign={() => dispatch({ type: "resign", color })} onOfferDraw={() => dispatch({ type: "offer-draw", color })}
                    onFlip={() => setFlipped(value => !value)} onCopyLink={copyLink} />, onRematch: offerRematch, rematchLabel: rematch ? "Rematch requested" : "Request rematch" }} />
            <aside className="online-match-panel" aria-label="Match information">
                <div className="match-info-heading"><span className="turn-dot white" /><strong>{finished ? "Match finished" : game.turn === color ? "Your turn" : "Waiting for opponent"}</strong></div>
                <p className="online-playing-as">Playing as <strong>{players[color].name}</strong> · {color === "white" ? "White" : "Black"}</p>
                <dl className="online-match-details"><div><dt>Mode</dt><dd>{label}</dd></div><div><dt>Time control</dt><dd>5 min · paused</dd></div><div><dt>Game</dt><dd>Preview</dd></div></dl>
                {game.drawOffer && <div className="online-offer" role="status"><strong>{game.drawOffer === color ? "Draw offer sent" : "Your opponent offers a draw"}</strong><p>{game.drawOffer === color ? "Waiting for your opponent’s response." : "Accept to end this match as a draw."}</p>{game.drawOffer !== color && <div><button className="quiet-button" onClick={() => dispatch({ type: "respond-draw", color, accept: true })}>Accept draw</button><button className="quiet-button" onClick={() => dispatch({ type: "respond-draw", color, accept: false })}>Decline</button></div>}</div>}
                {finished && <div className="online-offer"><strong>{rematch ? "Rematch requested" : "Another game?"}</strong><p>{rematch ? "The other player must agree before a new game starts." : "Invite your opponent to play again."}</p>{rematch && rematchFrom !== color ? <button className="quiet-button" onClick={() => { dispatch({ type: "restart", board: parseFen(startingFen) }); setRematch(false); setRematchFrom(null); setNotice(""); setMatchNumber(n => n + 1); }}>Accept rematch</button> : <button className="quiet-button" disabled={rematch} onClick={offerRematch}>Request rematch</button>}</div>}
                <div className="online-move-heading"><h2>Moves</h2><span>{moves.length} played</span></div>
                {moves.length ? <ol className="online-moves">{Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => <li key={i}><span>{i + 1}.</span><span>{moves[i * 2]}</span><span>{moves[i * 2 + 1] ?? "—"}</span></li>)}</ol> : <p className="online-empty-moves">The opening move is yours.<br />Select a piece to begin.</p>}
                <p className="online-notice" role="status">{notice}</p>
                <Link className="online-home-link" href="/">Back to play</Link>
            </aside>
        </div>
    </section>;
}
