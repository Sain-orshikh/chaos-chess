import { createGame, gameReducer, isGameOver, parseFen, pieceColor } from '../generated/chess.js';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const GRACE_MS = 60_000;
export const LEASE_MS = 20_000;
const other = color => color === 'white' ? 'black' : 'white';
export class MatchError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
export function initialMatch(ruleset, timeMs, incrementMs, now) {
    return { version: 0, revision: 0, game: createGame(parseFen(START_FEN), 'white', undefined, ruleset), history: [], requests: [],
        clocks: { white: timeMs, black: timeMs }, timeMs, incrementMs, turnStartedAt: now, movesBy: { white: 0, black: 0 },
        presence: { white: {}, black: {} }, absentSince: { white: now, black: now }, rematch: null, nextGameId: null, outcome: null };
}
export function clockAt(state, now) {
    const clocks = { ...state.clocks };
    if (!state.outcome) clocks[state.game.turn] = Math.max(0, clocks[state.game.turn] - Math.max(0, now - state.turnStartedAt));
    return clocks;
}
function finish(state, outcome, now) {
    state.clocks = clockAt(state, now); state.outcome = outcome; state.game.selectedSquare = null; state.game.pendingPromotion = null; state.game.drawOffer = null;
    state.game.status = outcome.reason === 'stalemate' ? { kind: 'stalemate' } : outcome.result === 'draw' || outcome.result === null ? { kind: 'draw', reason: outcome.reason }
        : { kind: outcome.reason === 'checkmate' ? 'checkmate' : outcome.reason === 'resignation' ? 'resigned' : outcome.reason, winner: outcome.result };
}
// Conservative possible-mate test: only conclude impossible for the unambiguous cases.
// A lone minor can mate with help from an opponent's remaining pieces.
export function canPossiblyMate(game, color) {
    const own = game.board.map((p, i) => ({ p, i })).filter(({ p }) => pieceColor(p) === color && Math.abs(p) !== 7);
    if (!own.length) return false;
    if (game.ruleset === 'chaos' && own.some(({ p }) => Math.abs(p) !== 3)) return true;
    const enemyHasPiece = game.board.some(p => pieceColor(p) === other(color) && Math.abs(p) !== 7);
    if (!enemyHasPiece && own.length === 1 && [2, 3].includes(Math.abs(own[0].p))) return false;
    if (!enemyHasPiece && own.every(({ p }) => Math.abs(p) === 3) && new Set(own.map(({ i }) => (Math.floor(i / 8) + i % 8) % 2)).size === 1) return false;
    return true;
}
export function settle(state, now) {
    if (state.outcome) return false;
    const flagAt = state.turnStartedAt + state.clocks[state.game.turn];
    const disconnects = ['white', 'black'].map(color => {
        const latest = Math.max(0, ...Object.values(state.presence[color]));
        const absent = latest > now ? null : latest || state.absentSince[color];
        return { color, at: absent === null ? Infinity : absent + GRACE_MS };
    }).sort((a, b) => a.at - b.at);
    const disconnected = disconnects[0];
    if (flagAt <= now && flagAt <= disconnected.at) {
        const winner = other(state.game.turn);
        finish(state, { result: canPossiblyMate(state.game, winner) ? winner : 'draw', reason: 'timeout', at: flagAt }, flagAt);
    } else if (disconnected.at <= now) {
        const simultaneous = disconnected.at === disconnects[1].at;
        finish(state, { result: simultaneous || !state.movesBy[disconnected.color] ? null : other(disconnected.color), reason: simultaneous || !state.movesBy[disconnected.color] ? 'abandoned' : 'disconnect', at: disconnected.at }, disconnected.at);
    } else return false;
    state.revision++; return true;
}
export function transition(input, color, command, now, lagMs = 0) {
    const state = structuredClone(input);
    if (settle(state, now)) return state;
    if (!command || typeof command !== 'object') throw new MatchError('Invalid command.', 400);
    if (typeof command.id !== 'string' || !/^[\w-]{8,80}$/.test(command.id)) throw new MatchError('Invalid request ID.', 400);
    const previous = state.requests.find(request => request.id === command.id);
    if (previous) {
        if (previous.color !== color || previous.payload !== JSON.stringify(command)) throw new MatchError('Request ID was already used.');
        return state;
    }
    if (!Number.isSafeInteger(command.revision) || command.revision !== state.revision) throw new MatchError('The position changed. Please try again.');
    if (state.outcome && !['rematch', 'accept-rematch', 'decline-rematch'].includes(command.type)) throw new MatchError('This match has ended.');
    if (command.type === 'move') {
        if (state.game.turn !== color) throw new MatchError('It is not your turn.');
        if (!command.move || !Number.isInteger(command.move.from) || command.move.from < 0 || command.move.from > 63) throw new MatchError('Invalid move.', 400);
        const next = gameReducer(state.game, { type: 'engine-move', move: command.move, expectedBoard: state.game.board, turn: color });
        if (next === state.game) throw new MatchError('That move is not legal.', 400);
        state.clocks = clockAt(state, now); state.clocks[color] += state.incrementMs + Math.min(100, Math.max(0, Number.isFinite(lagMs) ? lagMs : 0), Math.max(0, now - state.turnStartedAt)); state.turnStartedAt = now;
        state.game = next; state.movesBy[color]++; state.history.push(next.lastMove);
        if (isGameOver(next.status)) finish(state, { result: 'winner' in next.status ? next.status.winner : 'draw', reason: next.status.kind === 'draw' ? next.status.reason : next.status.kind, at: now }, now);
    } else if (command.type === 'resign') finish(state, { result: other(color), reason: 'resignation', at: now }, now);
    else if (command.type === 'offer-draw') {
        if (state.game.drawOffer) throw new MatchError('There is already a draw offer.');
        state.game.drawOffer = color;
    } else if (command.type === 'respond-draw') {
        if (!state.game.drawOffer || state.game.drawOffer === color || typeof command.accept !== 'boolean') throw new MatchError('There is no opponent draw offer.');
        if (command.accept) finish(state, { result: 'draw', reason: 'agreement', at: now }, now);
        else state.game.drawOffer = null;
    } else if (command.type === 'rematch' || command.type === 'accept-rematch' || command.type === 'decline-rematch') {
        if (!state.outcome) throw new MatchError('Finish this match first.');
        if (command.type === 'rematch') { if (state.rematch) throw new MatchError('Rematch already requested.'); state.rematch = color; }
        else { if (!state.rematch || state.rematch === color) throw new MatchError('There is no opponent rematch request.'); if (command.type === 'decline-rematch') state.rematch = null; }
    } else throw new MatchError('Unknown command.', 400);
    state.revision++; state.requests.push({ id: command.id, color, payload: JSON.stringify(command) });
    return state;
}
export function presence(input, color, connection, connected, now) {
    const state = structuredClone(input);
    if (state.outcome) return state;
    for (const side of ['white', 'black']) for (const [id, expiry] of Object.entries(state.presence[side])) {
        if (expiry <= now) { state.absentSince[side] = Math.max(state.absentSince[side] ?? 0, expiry); delete state.presence[side][id]; }
    }
    if (connected) { if (!state.presence[color][connection] && Object.keys(state.presence[color]).length >= 8) throw new MatchError('Too many open match tabs.', 429); state.presence[color][connection] = now + LEASE_MS; state.absentSince[color] = null; }
    else if (state.presence[color][connection]) { delete state.presence[color][connection]; if (!Object.keys(state.presence[color]).length) state.absentSince[color] = now; }
    return state;
}
export function publicMatch(document, color, now) {
    const s = document.live;
    return { gameId: String(document._id), color, ruleset: s.game.ruleset, revision: s.revision, game: s.game, history: s.history,
        clocks: clockAt(s, now), serverNow: now, incrementMs: s.incrementMs, timeMs: s.timeMs,
        connected: Object.fromEntries(['white', 'black'].map(side => [side, Object.values(s.presence[side]).some(expiry => expiry > now)])),
        outcome: s.outcome, rematch: s.rematch, nextGameId: s.nextGameReady ? s.nextGameId : null, ratings: document.ratings, rated: document.rated, players: document.players,
        achievements: document.achievements?.[color === 'white' ? 'a' : 'b'] || null };
}
