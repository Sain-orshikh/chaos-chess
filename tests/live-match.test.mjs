import { memory, infra } from './fixtures/live-support.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { WebSocket } from 'ws';
import { initialMatch, transition, presence, settle, clockAt, canPossiblyMate } from '../backend/live/state.js';
import { legalMovesForPiece, createGame, parseFen } from '../backend/generated/chess.js';
import { createMatchService } from '../backend/live/service.js';
import { attachLiveSockets } from '../backend/live/transport.js';
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb', ID = 'cccccccccccccccccccccccc';
const start = () => initialMatch('normal', 300_000, 2000, 1_000_000);
function request(state, type, extra = {}, id = `request-${state.revision}`) { return { type, id, revision: state.revision, ...extra }; }
function move(state, from, to, now = 1_001_000, extra = {}) { const m = legalMovesForPiece(state.game.board, from, state.game.castling, state.game.standard).find(m => m.to === to && (!extra.promotion || m.promotion === extra.promotion)); assert.ok(m); return transition(state, state.game.turn, request(state, 'move', { move: m }), now); }
test('server accepts one legal source move, keeps clocks and increment, rejects stale/wrong-side/illegal input', () => {
    const s = start(), next = move(s, 52, 36);
    assert.equal(next.game.turn, 'black'); assert.equal(next.clocks.white, 301_000); assert.equal(next.movesBy.white, 1); assert.equal(next.history.length, 1);
    assert.equal(s.history.length, 0); assert.equal(next.game.standard.enPassantTarget, 44);
    assert.throws(() => transition(next, 'white', request(next, 'move', { move: { from: 36, to: 28, kind: 'm' } }), 1_001_500), /not your turn/);
    assert.throws(() => transition(next, 'black', request(s, 'resign', {}, 'stale-request'), 1_001_500), /position changed/);
    assert.throws(() => transition(s, 'white', request(s, 'move', { move: { from: 52, to: 20, kind: 'm' } }), 1_001_000), /not legal/);
    assert.throws(() => transition(s, 'white', { type: 'resign' }, 1_001_000), /request ID/);
});
test('duplicate request is idempotent; reusing its ID for a different command is rejected', () => {
    const s = start(), cmd = request(s, 'offer-draw'), next = transition(s, 'white', cmd, 1_000_100);
    assert.deepEqual(transition(next, 'white', cmd, 1_000_200), next);
    assert.throws(() => transition(next, 'black', cmd, 1_000_200), /already used/);
    assert.throws(() => transition(next, 'white', { ...cmd, type: 'resign' }, 1_000_200), /already used/);
});
test('complete promotion, Chaos rotation, castling and en passant use the shared rules', () => {
    let s = start(); s.game = createGame(parseFen('7k/P7/8/8/8/8/8/7K w - - 0 1'), 'white', undefined, 'normal');
    s = move(s, 8, 0, 1_001_000, { promotion: 'queen' }); assert.equal(s.game.board[0], 6); assert.equal(s.game.pendingPromotion, null);
    s = initialMatch('chaos', 300_000, 0, 1_000_000);
    const rotation = legalMovesForPiece(s.game.board, 56, s.game.castling).find(m => m.kind === 'rotate');
    assert.ok(rotation); s = transition(s, 'white', request(s, 'move', { move: rotation }), 1_001_000); assert.equal(s.game.board[56], 5);
    s = start(); s.game = createGame(parseFen('4k2r/7p/8/8/8/8/7P/R3K2R w KQk - 0 1'), 'white', undefined, 'normal');
    s = move(s, 60, 62); assert.equal(s.game.board[61], 4); assert.equal(s.game.standard.castlingRights.white.kingSide, false);
    s = start(); s = move(s, 52, 36); s = move(s, 8, 16, 1_002_000); s = move(s, 36, 28, 1_003_000); s = move(s, 11, 27, 1_004_000); s = move(s, 28, 19, 1_005_000); assert.equal(s.game.board[27], 0); assert.equal(s.game.halfmoveClock, 0);
});
test('draw consent, expiry, resignation and rematch require the correct side and state', () => {
    let s = start(); s = transition(s, 'white', request(s, 'offer-draw'), 1_000_100);
    assert.throws(() => transition(s, 'white', request(s, 'respond-draw', { accept: true }), 1_000_200), /opponent draw/);
    s = move(s, 52, 36); s = move(s, 12, 28, 1_002_000); assert.equal(s.game.drawOffer, null);
    s = transition(s, 'black', request(s, 'offer-draw'), 1_002_100); s = transition(s, 'white', request(s, 'respond-draw', { accept: true }), 1_002_200); assert.equal(s.outcome.result, 'draw');
    s = transition(s, 'white', request(s, 'rematch'), 1_002_300);
    assert.throws(() => transition(s, 'white', request(s, 'accept-rematch'), 1_002_400), /opponent rematch/);
    s = transition(s, 'black', request(s, 'accept-rematch'), 1_002_400); assert.equal(s.rematch, 'white');
    const resigned = transition(start(), 'white', request(start(), 'resign'), 1_001_000); assert.equal(resigned.outcome.result, 'black');
});
test('disconnect before first own move abandons; after first own move loses; timeout takes earlier precedence', () => {
    let s = start(); s = presence(s, 'white', 'white-one', true, 1_000_000); s = presence(s, 'black', 'black-one', true, 1_000_000);
    s = presence(s, 'white', 'white-one', false, 1_000_100); s = presence(s, 'black', 'black-one', true, 1_059_000);
    assert.equal(settle(s, 1_060_099), false); assert.equal(settle(s, 1_060_100), true); assert.equal(s.outcome.result, null);
    s = move(start(), 52, 36); s = presence(s, 'white', 'one', true, 1_001_000); s = presence(s, 'black', 'two', true, 1_001_000); s = presence(s, 'white', 'one', false, 1_001_001); s = presence(s, 'black', 'two', true, 1_060_000);
    settle(s, 1_061_001); assert.equal(s.outcome.result, 'black'); assert.equal(s.outcome.reason, 'disconnect');
    s = start(); s.clocks.white = 30_000; settle(s, 1_070_000); assert.equal(s.outcome.reason, 'timeout'); assert.equal(s.outcome.at, 1_030_000);
});
test('multiple tabs, stale closes and reconnect preserve presence; clocks continue during absence', () => {
    let s = start(); s = presence(s, 'white', 'old', true, 1_000_000); s = presence(s, 'white', 'new', true, 1_001_000); s = presence(s, 'white', 'old', false, 1_002_000);
    assert.equal(s.absentSince.white, null); assert.equal(s.presence.white.new, 1_021_000);
    s = presence(s, 'white', 'old', false, 1_003_000); assert.equal(s.absentSince.white, null);
    assert.equal(clockAt(s, 1_010_000).white, 290_000);
    s = presence(s, 'white', 'reconnect', true, 1_075_000); s = presence(s, 'black', 'b', true, 1_075_000); assert.equal(settle(s, 1_080_000), false);
});
test('flag draws for bare king and lone normal minor; Chaos knight can win', () => {
    const s = start(); s.game = createGame(parseFen('7k/8/8/8/8/8/8/N6K w - - 0 1'), 'white', undefined, 'normal');
    assert.equal(canPossiblyMate(s.game, 'white'), false); assert.equal(canPossiblyMate(s.game, 'black'), false);
    s.game.ruleset = 'chaos'; assert.equal(canPossiblyMate(s.game, 'white'), true);
    s.game = createGame(parseFen('7k/8/8/8/8/8/8/B6K w - - 0 1'), 'white', undefined, 'chaos'); assert.equal(canPossiblyMate(s.game, 'white'), false);
});
test('atomic service handles simultaneous moves, unauthorized users, durable deadlines and rating retry', async () => {
    const db = memory(), bus = infra(); let time = 1_000_000, finalizations = 0;
    const service = createMatchService({ model: db.model, infra: bus, now: () => time, finalize: async (_req, res) => { finalizations++; res.status(200).json({}); } });
    await service.create({ id: ID, white: { _id: A, username: 'a', elo: 1200 }, black: { _id: B, username: 'b', elo: 1200 }, ruleset: 'normal' });
    assert.ok(bus.scheduled.length); await assert.rejects(service.snapshot(ID, 'outsider'), /not a player/);
    const s = db.docs.get(ID).live, legal = legalMovesForPiece(s.game.board, 52, s.game.castling, s.game.standard).find(m => m.to === 36);
    time += 1000;
    const cmd = request(s, 'move', { move: legal });
    const results = await Promise.all([service.command(ID, A, cmd), service.command(ID, A, cmd)]);
    assert.equal(results[0].history.length, 1); assert.equal(db.docs.get(ID).live.history.length, 1);
    let snap = await service.snapshot(ID, A); await service.command(ID, A, { type: 'resign', id: 'resign-unique', revision: snap.revision }); assert.ok(finalizations);
    snap = await service.snapshot(ID, A); assert.equal(snap.outcome.reason, 'resignation');
    await service.command(ID, A, { type: 'rematch', id: 'rematch-unique', revision: snap.revision }); snap = await service.snapshot(ID, B);
    const next = await service.command(ID, B, { type: 'accept-rematch', id: 'accept-unique', revision: snap.revision });
    const rematch = db.docs.get(next.nextGameId); assert.equal(rematch.playerA, B); assert.equal(rematch.playerB, A); assert.equal(rematch.live.history.length, 0);
    assert.equal(next.players.white.name, 'a');
});
test('two authenticated socket clients exchange authoritative moves, reconnect snapshot and draw; spectators rejected', async () => {
    const db = memory(), bus = infra();
    const service = createMatchService({ model: db.model, infra: bus, finalize: async (_req, res) => res.status(200).json({}) });
    await service.create({ id: ID, white: { _id: A, username: 'white', elo: 1200 }, black: { _id: B, username: 'black', elo: 1200 }, ruleset: 'normal', rated: false });
    const server = http.createServer((_req, res) => res.end());
    const wss = attachLiveSockets(server, { runtime: () => ({ service, infra: bus }), connect: async () => {}, authenticate: async req => ({ userId: req.headers.cookie === 'a' ? A : req.headers.cookie === 'b' ? B : 'eeeeeeeeeeeeeeeeeeeeeeee', expires: Date.now() + 60_000 }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}/api/live/${ID}/socket`;
    const open = cookie => new WebSocket(url, { origin: 'http://localhost:3000', headers: { Cookie: cookie } });
    const wait = (ws, predicate) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error('Socket snapshot timeout')); }, 5000);
        function listener(raw) { const message = JSON.parse(String(raw)); if (predicate(message)) { clearTimeout(timeout); ws.off('message', listener); resolve(message.data); } }
        ws.on('message', listener);
    });
    let a, b, replacement, spectator;
    try {
        spectator = open('outsider'); const rejection = await new Promise((resolve, reject) => { spectator.on('unexpected-response', (_request, response) => { response.resume(); spectator.terminate(); resolve(response.statusCode); }); spectator.on('error', () => {}); spectator.on('open', () => reject(new Error('Spectator was admitted'))); }); assert.equal(rejection, 403);
        a = open('a'); const first = await wait(a, x => x.type === 'snapshot'); b = open('b'); await wait(b, x => x.type === 'snapshot');
        const m = legalMovesForPiece(first.game.board, 52, first.game.castling, first.game.standard).find(m => m.to === 36);
        const opponentSaw = wait(b, x => x.type === 'snapshot' && x.data.history.length === 1);
        a.send(JSON.stringify({ id: 'socket-move', revision: first.revision, type: 'move', move: m })); const after = await opponentSaw; assert.equal(after.game.turn, 'black');
        replacement = open('a'); const recovered = await wait(replacement, x => x.type === 'snapshot' && x.data.history.length === 1); assert.equal(recovered.game.board[36], 1);
        a.close(); await once(a, 'close');
        const offered = wait(b, x => x.type === 'snapshot' && x.data.game.drawOffer === 'white'); replacement.send(JSON.stringify({ id: 'socket-draw', revision: recovered.revision, type: 'offer-draw' })); const offer = await offered;
        const ended = wait(replacement, x => x.type === 'snapshot' && x.data.outcome?.reason === 'agreement'); b.send(JSON.stringify({ id: 'socket-accept', revision: offer.revision, type: 'respond-draw', accept: true })); assert.equal((await ended).outcome.result, 'draw');
        assert.ok(bus.commands > 0);
    } finally { for (const ws of [a, b, replacement]) ws?.terminate(); wss.close(); server.close(); server.closeAllConnections(); }
});

test('durable scheduling failure cannot commit a move; publish and rating failures recover from stored state', async () => {
    const db = memory(), bus = infra(); let failSchedule = false, failPublish = false, ratingsFail = true, time = 1_000_000;
    const adapter = { ...bus, async schedule(...args) { if (failSchedule) throw new Error('scheduler unavailable'); return bus.schedule(...args); }, async publish(...args) { if (failPublish) throw new Error('pubsub unavailable'); return bus.publish(...args); } };
    const service = createMatchService({ model: db.model, infra: adapter, now: () => time, finalize: async (_req, res) => { if (ratingsFail) return res.status(503).json({ error: 'ratings unavailable' }); db.docs.get(ID).finalizedAt = new Date(); db.docs.get(ID).ratings = { a: { before: 1200, after: 1184, change: -16 }, b: { before: 1200, after: 1216, change: 16 } }; res.status(200).json({}); } });
    await service.create({ id: ID, white: { _id: A, username: 'a', elo: 1200 }, black: { _id: B, username: 'b', elo: 1200 }, ruleset: 'normal' });
    let state = db.docs.get(ID).live; const legal = legalMovesForPiece(state.game.board, 52, state.game.castling, state.game.standard).find(m => m.to === 36);
    failSchedule = true; await assert.rejects(service.command(ID, A, request(state, 'move', { move: legal })), /scheduler unavailable/); assert.equal(db.docs.get(ID).live.history.length, 0);
    failSchedule = false; failPublish = true; time += 1000; await service.command(ID, A, request(state, 'move', { move: legal })); assert.equal((await service.snapshot(ID, B)).history.length, 1);
    state = db.docs.get(ID).live; const ended = await service.command(ID, A, request(state, 'resign')); assert.equal(ended.outcome.result, 'black'); assert.equal(ended.ratings, undefined);
    ratingsFail = false; const recovered = await service.snapshot(ID, A); assert.equal(recovered.ratings.a.after, 1184); assert.ok(db.docs.get(ID).finalizedAt);
});
test('late durable wakeup settles a match even with no browsers, using exact event time', async () => {
    const db = memory(), bus = infra(); let time = 1_000_000;
    const service = createMatchService({ model: db.model, infra: bus, now: () => time });
    await service.create({ id: ID, white: { _id: A }, black: { _id: B }, ruleset: 'normal', rated: false });
    time += 100_000; await service.deadline(ID); const stored = db.docs.get(ID); assert.equal(stored.live.outcome.reason, 'abandoned'); assert.equal(stored.live.outcome.at, 1_060_000); assert.equal(stored.rated, false);
});
test('server-measured lag allowance is bounded and never resurrects an already expired clock', () => {
    const state = start(), legal = legalMovesForPiece(state.game.board, 52, state.game.castling, state.game.standard).find(m => m.to === 36);
    const result = transition(state, 'white', request(state, 'move', { move: legal }), 1_001_000, 20_000); assert.equal(result.clocks.white, 301_100);
    state.clocks.white = 500; const late = transition(state, 'white', request(state, 'move', { move: legal }), 1_001_000, 100); assert.equal(late.outcome.reason, 'timeout'); assert.equal(late.history.length, 0);
});
test('deadline signatures bind the exact body and public URL, support key rotation, and reject invalid tokens', async () => {
    const { createHash } = await import('node:crypto');
    const { default: jwt } = await import('jsonwebtoken');
    const { createLiveInfra, liveConfigured } = await import('../backend/live/infra.js');
    const values = { UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'fixture-token', QSTASH_TOKEN: 'fixture-token', QSTASH_CURRENT_SIGNING_KEY: 'fixture-current-key', QSTASH_NEXT_SIGNING_KEY: 'fixture-next-key', PUBLIC_API_URL: 'https://fixture.example' };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
        Object.assign(process.env, values); assert.equal(liveConfigured(), true);
        const adapter = createLiveInfra(), body = JSON.stringify({ gameId: ID });
        const sign = (key, url = 'https://fixture.example/api/live/deadline') => jwt.sign({ body: createHash('sha256').update(body).digest('base64url') }, key, { algorithm: 'HS256', issuer: 'Upstash', subject: url, expiresIn: 60 });
        assert.equal(await adapter.verify(sign(values.QSTASH_CURRENT_SIGNING_KEY), body), true);
        assert.equal(await adapter.verify(sign(values.QSTASH_NEXT_SIGNING_KEY), body), true);
        await assert.rejects(adapter.verify(sign(values.QSTASH_CURRENT_SIGNING_KEY), body + ' '), /body hash/);
        await assert.rejects(adapter.verify(sign(values.QSTASH_CURRENT_SIGNING_KEY, 'https://other.example/api/live/deadline'), body), /subject/);
        await assert.rejects(adapter.verify('invalid', body));
        delete process.env.QSTASH_TOKEN; assert.equal(liveConfigured(), false);
    } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
