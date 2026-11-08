// Explicit opt-in, loopback-only test fixture. No real accounts, Mongo, Redis, QStash or Elo writes.
if (process.env.LIVE_BROWSER_FIXTURE !== '1') throw new Error('Set LIVE_BROWSER_FIXTURE=1 to run this isolated browser fixture.');
const { createServer } = await import('node:http');
const { memory, infra } = await import('./live-support.mjs');
const { createMatchService } = await import('../../backend/live/service.js');
const { attachLiveSockets } = await import('../../backend/live/transport.js');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const CLASSIC = 'cccccccccccccccccccccccc', CHAOS = 'dddddddddddddddddddddddd';
const db = memory(), bus = infra();
const service = createMatchService({ model: db.model, infra: bus });
for (const [id, ruleset] of [[CLASSIC, 'normal'], [CHAOS, 'chaos']]) await service.create({ id, white: { _id: A, username: 'Alice', elo: 1200 }, black: { _id: B, username: 'Bob', elo: 1200 }, ruleset, rated: false, timeMs: 1_800_000 });
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/test-reset') { for (const id of [CLASSIC, CHAOS]) { const state = db.docs.get(id).live; const { initialMatch } = await import('../../backend/live/state.js'); db.docs.get(id).live = initialMatch(state.game.ruleset, state.timeMs, state.incrementMs, Date.now()); await bus.publish(id); } return res.end('reset'); }
    if (url.pathname === '/test-login') {
        const side = url.searchParams.get('side') === 'black' ? 'black' : 'white';
        res.setHeader('Set-Cookie', `fixture=${side}; Path=/; HttpOnly; SameSite=Lax`);
        res.writeHead(302, { Location: `http://${req.headers.host.split(':')[0]}:3006/classic/${CLASSIC}` }); return res.end();
    }
    if (url.pathname === '/api/auth/me') { const black = req.headers.cookie?.includes('fixture=black'); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ _id: black ? B : A, username: black ? 'Bob' : 'Alice', elo: 1200 })); }
    if (url.pathname === '/test-counts') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ adapterCalls: bus.commands, scheduled: bus.scheduled.length })); }
    res.writeHead(404); res.end();
});
attachLiveSockets(server, {
    runtime: () => ({ service, infra: bus }), connect: async () => {},
    originAllowed: origin => ['http://127.0.0.1:3006', 'http://localhost:3006'].includes(origin),
    authenticate: async req => { const cookie = req.headers.cookie || ''; if (!/fixture=(white|black)/.test(cookie)) throw new Error('Fixture sign-in required'); return { userId: cookie.includes('fixture=black') ? B : A, expires: Date.now() + 3_600_000 }; },
});
server.listen(5001, '127.0.0.1', () => console.log('Isolated multiplayer fixture on 127.0.0.1:5001'));
