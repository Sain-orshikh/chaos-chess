import express from 'express';
import { protectRoute } from '../middleware/protectRoute.js';
import { liveRuntime } from '../live/transport.js';
import { createMatchmaker } from './service.js';
import { MatchError } from '../live/state.js';
import { logger } from '../logging/logger.js';
let matchmaking;
function runtime() {
    const live = liveRuntime();
    matchmaking ||= createMatchmaker({ matches: live.service });
    return { ...live, matchmaking };
}
export function createMatchmakingRouter({ getRuntime = runtime, authenticate = protectRoute } = {}) {
    const router = express.Router();
    const route = fn => async (req, res) => {
        try { res.json(await fn(req, getRuntime())); }
        catch (error) {
            logger.warn({ err: error, event: 'matchmaking_error' }, 'Matchmaking request failed');
            res.status(error.status || 503).json({ error: error instanceof MatchError ? error.message : 'Matchmaking is temporarily unavailable. Please try again.' });
        }
    };
    router.get('/counts', route(async (_req, { infra, matchmaking }) => ({ online: await infra.online(), queues: await matchmaking.counts() })));
    router.post('/presence', authenticate, route((req, { infra }) => infra.online(String(req.user._id)).then(online => ({ online }))));
    router.use(['/join', '/status', '/leave', '/cancel'], authenticate);
    router.use(['/join', '/status', '/leave'], (req, res, next) => {
        if (typeof req.body?.connection !== 'string' || !/^[a-f0-9-]{36}$/i.test(req.body.connection)) return res.status(400).json({ error: 'Reload the matchmaking page and try again.' });
        next();
    });
    router.post('/join', route((req, { matchmaking }) => matchmaking.run(String(req.user._id), 'join', req.body)));
    router.post('/status', route((req, { matchmaking }) => matchmaking.run(String(req.user._id), 'status', req.body)));
    router.post('/leave', route((req, { matchmaking }) => matchmaking.run(String(req.user._id), 'leave', req.body)));
    router.post('/cancel', route((req, { matchmaking }) => matchmaking.run(String(req.user._id), 'cancel')));
    return router;
}
export const matchmakingRouter = createMatchmakingRouter();
