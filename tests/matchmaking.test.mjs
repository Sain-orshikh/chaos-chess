import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingRange, compatible, chooseOpponent } from '../backend/matchmaking/policy.js';
import { queueFixture } from './fixtures/live-queue.mjs';
import { createMatchmakingRouter } from '../backend/matchmaking/transport.js';
import express from 'express';
import http from 'node:http';
import { once } from 'node:events';
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb', C = 'cccccccccccccccccccccccc';
const config = { ruleset: 'normal', timeMs: 300_000, connection: '12345678-1234-1234-1234-123456789abc' };
const ticket = (id, rating, joinedAt = 0) => ({ _id: id, rating, joinedAt, expiresAt: 200_000, ...config });
test('range expands at exact boundaries and requires mutual acceptance', () => {
    for (const [ms, expected] of [[0, 100], [4999, 100], [5000, 200], [10000, 300], [20000, 500], [35000, 800], [59999, 800], [60000, null]]) assert.equal(ratingRange(0, ms), expected);
    assert.equal(compatible(ticket(A, 1200), ticket(B, 2000, 60_000), 60_000), false);
    assert.equal(compatible(ticket(A, 1200), ticket(B, 3000), 60_000), true);
    assert.equal(compatible(ticket(A, 1200), { ...ticket(B, 1200), ruleset: 'chaos' }, 0), false);
    assert.equal(compatible(ticket(A, 1200), { ...ticket(B, 1200), timeMs: 600_000 }, 0), false);
    assert.equal(compatible(ticket(A, 1200), { ...ticket(B, 1200), expiresAt: 10 }, 10), false);
});
test('oldest compatible opponent wins, then closest rating breaks ties', () => {
    const self = ticket(A, 1200, 1000), far = ticket(B, 1250), close = ticket(C, 1201, 500);
    assert.equal(chooseOpponent(self, [close, far], 1000)._id, B);
    close.joinedAt = 0; assert.equal(chooseOpponent(self, [far, close], 1000)._id, C);
});
test('concurrent joins and repeated tabs produce one rated match with a zero-increment clock', async () => {
    const f = queueFixture(); f.add(A); f.add(B); f.add(C);
    await Promise.all([f.matchmaking.run(A, 'join', config), f.matchmaking.run(B, 'join', config), f.matchmaking.run(A, 'join', config), f.matchmaking.run(C, 'join', config)]);
    assert.equal(f.db.docs.size, 1);
    const game = [...f.db.docs.values()][0]; assert.equal(game.rated, true); assert.equal(game.live.incrementMs, 0); assert.equal(game.live.timeMs, 300_000);
    assert.equal(game.playerA, B); assert.equal(game.playerB, A);
    const a = await f.matchmaking.run(A, 'status'); const b = await f.matchmaking.run(B, 'status');
    assert.equal(a.gameId, b.gameId); assert.equal(a.gameId, game._id);
    assert.equal((await f.matchmaking.run(A, 'cancel')).state, 'matched');
    assert.equal((await f.matchmaking.run(C, 'status')).state, 'queued');
});
test('four distinct queues, server rating, rejected configuration and restored waiting time', async () => {
    const f = queueFixture(); f.add(A, 950); f.add(B, 950);
    const first = await f.matchmaking.run(A, 'join', { ...config, rating: 9000 }); assert.equal(f.tickets.get(A).rating, 950);
    await assert.rejects(f.matchmaking.run(A, 'join', { ...config, timeMs: 600_000 }), /Cancel/);
    await f.matchmaking.run(B, 'join', { ...config, ruleset: 'chaos' }); assert.equal(f.db.docs.size, 0);
    f.advance(10_000); assert.equal((await f.matchmaking.run(A, 'status')).joinedAt, first.joinedAt);
    assert.equal((await f.matchmaking.run(A, 'status')).range, 300);
    await assert.rejects(f.matchmaking.run(C, 'join', { ...config, timeMs: 1000 }), /Choose/);
});
test('heartbeats widen a quiet queue without another join', async () => {
    const f = queueFixture(); f.add(A, 1000); f.add(B, 1300);
    await f.matchmaking.run(A, 'join', config); await f.matchmaking.run(B, 'join', config);
    assert.equal(f.db.docs.size, 0); f.advance(10_000);
    assert.equal((await f.matchmaking.run(A, 'status')).state, 'matched'); assert.equal(f.db.docs.size, 1);
});
test('expired entries cannot match; cancelling then rejoining starts a fresh search', async () => {
    const f = queueFixture(); f.add(A); f.add(B);
    const first = await f.matchmaking.run(A, 'join', config); f.advance(45_000);
    assert.equal((await f.matchmaking.run(A, 'status')).state, 'idle');
    await f.matchmaking.run(B, 'join', config); assert.equal(f.db.docs.size, 0);
    await f.matchmaking.run(B, 'cancel'); const next = await f.matchmaking.run(A, 'join', config);
    assert.ok(next.joinedAt > first.joinedAt);
});
test('failed scheduling rolls back both tickets and no match is exposed', async () => {
    const f = queueFixture(); f.add(A); f.add(B);
    await f.matchmaking.run(A, 'join', config);
    f.bus.schedule = async () => { throw new Error('scheduler unavailable'); };
    await assert.rejects(f.matchmaking.run(B, 'join', config), /scheduler/);
    assert.equal(f.db.docs.size, 0); assert.equal(f.tickets.get(A).state, 'queued'); assert.equal(f.tickets.has(B), false);
});
test('cancel/pair race never leaves a player queued and matched; finished players can queue again', async () => {
    const f = queueFixture(); f.add(A); f.add(B);
    await f.matchmaking.run(A, 'join', config);
    await Promise.all([f.matchmaking.run(B, 'join', config), f.matchmaking.run(A, 'cancel')]);
    assert.equal(f.tickets.get(A).state, 'matched');
    [...f.db.docs.values()][0].status = 'finished';
    assert.equal((await f.matchmaking.run(A, 'join', { ...config, timeMs: 600_000 })).state, 'queued');
    assert.equal(f.tickets.get(A).timeMs, 600_000);
});
test('random color branch can assign either entrant White and supports 10-minute games', async () => {
    const f = queueFixture({ coin: () => 1 }); f.add(A); f.add(B);
    await f.matchmaking.run(A, 'join', { ...config, timeMs: 600_000 }); await f.matchmaking.run(B, 'join', { ...config, timeMs: 600_000 });
    const game = [...f.db.docs.values()][0]; assert.equal(game.playerA, A); assert.equal(game.live.clocks.white, 600_000);
});
test('HTTP routes reject guests and invalid queues and return only aggregate counts', async () => {
    const f = queueFixture(); f.add(A);
    const app = express(); app.use(express.json()); app.use('/api/matchmaking', createMatchmakingRouter({
        getRuntime: () => ({ matchmaking: f.matchmaking, infra: { online: async () => 2 } }),
        authenticate: (req, res, next) => { if (req.headers.authorization !== 'fixture') return res.status(401).json({ error: 'Sign in' }); req.user = { _id: A }; next(); },
    }));
    const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/matchmaking`;
        assert.equal((await fetch(`${url}/join`, { method: 'POST' })).status, 401);
        assert.equal((await fetch(`${url}/join`, { method: 'POST', headers: { Authorization: 'fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, timeMs: 1000 }) })).status, 400);
        const response = await fetch(`${url}/join`, { method: 'POST', headers: { Authorization: 'fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
        assert.equal((await response.json()).state, 'queued');
        const counts = await (await fetch(`${url}/counts`)).json(); assert.deepEqual(counts, { online: 2, queues: [{ ruleset: 'normal', timeMs: 300_000, count: 1 }] });
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('leaving one tab preserves another; last-tab departure stops pairing but reload restores waiting time', async () => {
    const f = queueFixture(); f.add(A); f.add(B);
    const joined = await f.matchmaking.run(A, 'join', { ...config, connection: 'one' });
    await f.matchmaking.run(A, 'status', { connection: 'two' });
    await f.matchmaking.run(A, 'leave', { connection: 'one' });
    assert.equal((await f.matchmaking.counts())[0].count, 1);
    await f.matchmaking.run(A, 'leave', { connection: 'two' });
    assert.deepEqual(await f.matchmaking.counts(), []);
    await f.matchmaking.run(B, 'join', config); assert.equal(f.db.docs.size, 0);
    await f.matchmaking.run(B, 'cancel'); f.advance(10_000);
    const restored = await f.matchmaking.run(A, 'status', { connection: 'new' });
    assert.equal(restored.joinedAt, joined.joinedAt); assert.equal(restored.range, 300);
    await f.matchmaking.run(A, 'leave', { connection: 'one' });
    assert.equal((await f.matchmaking.counts())[0].count, 1);
});
