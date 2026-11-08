// Loopback-only, explicit opt-in. Uses synthetic accounts and in-memory provider adapters.
if (process.env.LIVE_BROWSER_FIXTURE !== '1') throw new Error('Set LIVE_BROWSER_FIXTURE=1 for this isolated fixture.');
const { createServer } = await import('node:http');
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { queueFixture } = await import('./live-queue.mjs');
const { createMatchmakingRouter } = await import('../../backend/matchmaking/transport.js');
const { attachLiveSockets } = await import('../../backend/live/transport.js');
const f = queueFixture();
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
f.add(A, 1200, 'Alice'); f.add(B, 1250, 'Bob');
const online = new Map();
f.bus.online = async userId => { if (userId) online.set(userId, Date.now()); return [...online.values()].filter(time => time > Date.now() - 75_000).length; };
const app = express(); app.use(express.json()); app.use(cookieParser());
const identity = req => req.cookies?.fixture === 'white' ? A : req.cookies?.fixture === 'black' ? B : null;
const authenticate = (req, res, next) => { const id = identity(req); if (!id) return res.status(401).json({ error: 'Please sign in.' }); req.user = f.users.get(id); next(); };
app.get('/test-login', (req, res) => { res.cookie('fixture', req.query.side === 'black' ? 'black' : 'white', { httpOnly: true, sameSite: 'lax' }); res.redirect(`http://${req.headers.host.split(':')[0]}:3007/classic`); });
app.get('/api/auth/me', authenticate, (req, res) => res.json(req.user));
app.use('/api/matchmaking', createMatchmakingRouter({ getRuntime: () => ({ matchmaking: f.matchmaking, infra: f.bus }), authenticate }));
app.get('/api/live/:gameId', authenticate, async (req, res) => { try { res.json(await f.service.snapshot(req.params.gameId, req.user._id)); } catch (e) { res.status(e.status || 503).json({ error: e.message }); } });
app.get('/test-state', (_req, res) => res.json({ tickets: [...f.tickets.values()], games: [...f.db.docs.values()].map(game => ({ id: game._id, white: game.playerA, black: game.playerB, timeMs: game.live.timeMs, incrementMs: game.live.incrementMs, history: game.live.history.length })) }));
const server = createServer(app);
attachLiveSockets(server, { runtime: () => ({ service: f.service, infra: f.bus }), connect: async () => {},
    originAllowed: origin => ['http://127.0.0.1:3007', 'http://localhost:3007'].includes(origin),
    authenticate: async req => { const side = /fixture=(white|black)/.exec(req.headers.cookie || '')?.[1]; if (!side) throw new Error('Sign in'); return { userId: side === 'black' ? B : A, expires: Date.now() + 3_600_000 }; },
});
// The clock advances in real time while keeping unit tests deterministic.
setInterval(() => f.advance(1000), 1000).unref();
server.listen(5002, '127.0.0.1', () => console.log('Matchmaking fixture on 127.0.0.1:5002'));
