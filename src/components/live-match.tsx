"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Board from './board';
import GameActions from './game-actions';
import { gameReducer, isGameOver, type GameAction, type GameState } from './common/game_state';
import type { BasicMove, Color, Ruleset } from './utils/types';
import type { RatingChange } from '../lib/api';

type Snapshot = { gameId: string; color: Color; ruleset: Ruleset; revision: number; game: GameState; history: BasicMove[];
    clocks: Record<Color, number>; serverNow: number; timeMs: number; incrementMs: number;
    connected: Record<Color, boolean>; outcome: { result: Color | 'draw' | null; reason: string } | null;
    rematch: Color | null; nextGameId: string | null; rated: boolean; ratings: { a: RatingChange; b: RatingChange } | null;
    players: Record<Color, { name: string; image: string; rating: number }> };
const opposite = (color: Color): Color => color === 'white' ? 'black' : 'white';
const square = (index: number) => `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
function timeLabel(ms: number) { const seconds = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export default function LiveMatch({ ruleset, gameId }: { ruleset: Ruleset; gameId: string }) {
    const router = useRouter();
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [game, setGame] = useState<GameState | null>(null);
    const [connected, setConnected] = useState(false), [waiting, setWaiting] = useState(false);
    const [notice, setNotice] = useState('Connecting to your match…'), [flipped, setFlipped] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const current = useRef<Snapshot | null>(null), preview = useRef<GameState | null>(null);
    const socket = useRef<WebSocket | null>(null), pending = useRef<object | null>(null), receivedAt = useRef(0);
    useEffect(() => {
        let disposed = false, timer: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>, attempt = 0;
        function connect() {
            const url = new URL(`/api/live/${encodeURIComponent(gameId)}/socket`, window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(url); socket.current = ws;
            ws.onopen = () => { attempt = 0; setConnected(true); setNotice(''); if (pending.current) ws.send(JSON.stringify(pending.current)); heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' })); }, 10_000); };
            ws.onmessage = event => {
                let message; try { message = JSON.parse(event.data); } catch { return; }
                if (message.type === 'error') { setNotice(message.error); if (current.current) { preview.current = current.current.game; setGame(current.current.game); } pending.current = null; setWaiting(false); ws.send(JSON.stringify({ type: 'heartbeat' })); return; }
                if (message.type !== 'snapshot') return;
                const next = message.data as Snapshot;
                if (next.ruleset !== ruleset) { setNotice('This match uses a different ruleset.'); ws.close(); return; }
                if (current.current && next.revision < current.current.revision) return;
                const changed = !current.current || next.revision !== current.current.revision;
                if (changed || pending.current) { preview.current = next.game; setGame(next.game); }
                current.current = next; receivedAt.current = performance.now(); setElapsed(0); setSnapshot(next);
                if (pending.current && changed) { pending.current = null; setWaiting(false); }
                if (next.nextGameId) router.replace(`/${ruleset === 'normal' ? 'classic' : 'chaos'}/${next.nextGameId}`);
            };
            ws.onclose = event => {
                clearInterval(heartbeat); setConnected(false);
                if (disposed) return;
                setNotice(event.code === 4001 ? 'Your session expired. Sign in again to reconnect.' : 'Reconnecting… Your chess clock continues.');
                if (event.code !== 4001) timer = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++) + Math.random() * 250);
            };
            ws.onerror = () => setNotice('Could not connect. Check your connection and sign-in status.');
        }
        connect(); const repaint = setInterval(() => setElapsed(Math.max(0, performance.now() - receivedAt.current)), 100);
        return () => { disposed = true; clearTimeout(timer); clearInterval(heartbeat); clearInterval(repaint); socket.current?.close(); current.current = null; pending.current = null; };
    }, [gameId, ruleset, router]);
    const command = useCallback((type: string, extra: object = {}) => {
        const state = current.current, ws = socket.current;
        if (!state || !ws || ws.readyState !== WebSocket.OPEN || pending.current) return;
        const request = { ...extra, type, id: crypto.randomUUID(), revision: state.revision };
        pending.current = request; setWaiting(true); ws.send(JSON.stringify(request));
    }, []);
    const onAction = useCallback((action: GameAction) => {
        const state = current.current, before = preview.current;
        if (!state || !before || before.turn !== state.color || pending.current || socket.current?.readyState !== WebSocket.OPEN) return;
        if (!['click', 'rotate', 'promote'].includes(action.type)) return;
        const after = gameReducer(before, action);
        if (after.turn !== before.turn && after.lastMove) { command('move', { move: after.lastMove }); return; }
        preview.current = after; setGame(after);
    }, [command]);
    if (!snapshot || !game) return <section className="match-unavailable"><h1>Your match</h1><p role="status">{notice}</p><Link href="/login">Sign in</Link> · <Link href="/">Back to play</Link></section>;
    const color = snapshot.color, finished = isGameOver(game.status), orientation = flipped ? opposite(color) : color;
    const clocks = { ...snapshot.clocks };
    if (!snapshot.outcome) clocks[snapshot.game.turn] = Math.max(0, clocks[snapshot.game.turn] - elapsed);
    const rating = snapshot.ratings?.[color === 'white' ? 'a' : 'b'];
    const ratingSummary = <p className="result-unrated">{snapshot.outcome?.reason === 'abandoned' ? 'Abandoned · No rating change' : !snapshot.rated ? 'Unrated match' : rating ? `Rating ${rating.before} → ${rating.after} (${rating.change >= 0 ? '+' : ''}${rating.change})` : 'Rating update pending'}</p>;
    return <section className="online-match-page"><div className="page-heading"><div><p className="online-eyebrow">MULTIPLAYER</p><h1>{ruleset === 'normal' ? 'Classic Chess' : 'Chaos Chess'}</h1></div><span className="preview-tag">{connected ? 'Connected' : 'Reconnecting'}</span></div>
        <div className="online-match-layout"><Board game={game} onAction={onAction} ruleset={ruleset} orientation={orientation} locked={!connected || waiting || game.turn !== color}
            online={{ players: snapshot.players, color, live: true, clocks: { white: timeLabel(clocks.white), black: timeLabel(clocks.black) }, ratingSummary,
                controls: <GameActions finished={finished} drawDisabled={!connected || waiting || !!game.drawOffer || !!game.pendingPromotion}
                    onResign={() => command('resign')} onOfferDraw={() => command('offer-draw')} onFlip={() => setFlipped(value => !value)}
                    onCopyLink={async () => { try { await navigator.clipboard.writeText(window.location.href); setNotice('Game link copied.'); } catch { setNotice('Copy the link from your address bar.'); } }} />,
                onRematch: () => { if (!snapshot.rematch) command('rematch'); else if (snapshot.rematch !== color) command('accept-rematch'); },
                rematchLabel: snapshot.rematch === color ? 'Rematch requested' : snapshot.rematch ? 'Accept rematch' : 'Request rematch' }} />
            <aside className="online-match-panel" aria-label="Match information"><div className="match-info-heading"><strong>{finished ? 'Match finished' : waiting ? 'Sending…' : game.turn === color ? 'Your turn' : 'Waiting for opponent'}</strong></div>
                <p>Playing as {color === 'white' ? 'White' : 'Black'}</p><p>{Math.round(snapshot.timeMs / 60_000)} min + {snapshot.incrementMs / 1000} sec</p>
                {!snapshot.connected[opposite(color)] && !finished && <p role="status">Opponent disconnected. They have 60 seconds to return; their chess clock continues.</p>}
                {game.drawOffer && <div className="online-offer"><strong>{game.drawOffer === color ? 'Draw offer sent' : 'Your opponent offers a draw'}</strong>{game.drawOffer !== color && <div><button disabled={waiting || !connected} className="quiet-button" onClick={() => command('respond-draw', { accept: true })}>Accept draw</button><button disabled={waiting || !connected} className="quiet-button" onClick={() => command('respond-draw', { accept: false })}>Decline</button></div>}</div>}
                {finished && <div className="online-offer">{snapshot.rematch && snapshot.rematch !== color ? <><p>Your opponent requested a rematch.</p><button disabled={waiting || !connected} className="quiet-button" onClick={() => command('accept-rematch')}>Accept rematch</button><button disabled={waiting || !connected} className="quiet-button" onClick={() => command('decline-rematch')}>Decline</button></> : <button disabled={waiting || !connected || !!snapshot.rematch} className="quiet-button" onClick={() => command('rematch')}>{snapshot.rematch ? 'Rematch requested' : 'Request rematch'}</button>}</div>}
                <h2>Moves</h2><ol className="online-moves">{snapshot.history.map((move, i) => <li key={i}><span>{i + 1}.</span><span>{square(move.from)} → {square(move.to)}{move.kind === 'rotate' ? ' (switch)' : 'promotion' in move && move.promotion ? ` = ${move.promotion}` : ''}</span></li>)}</ol>
                <p className="online-notice" role="status">{notice}</p><Link href="/">Back to play</Link>
            </aside></div></section>;
}
