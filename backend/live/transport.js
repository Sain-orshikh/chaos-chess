import express from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import User from '../models/user.model.js';
import { allowedOrigin } from '../config/cors.js';
import { protectRoute } from '../middleware/protectRoute.js';
import connectMongoDB from '../db/connectMongoDB.js';
import { logger } from '../logging/logger.js';
import { liveConfigured, createLiveInfra } from './infra.js';
import { createMatchService } from './service.js';
import { createMongoRateLimitStore } from '../security/rateLimitStore.js';
import { MatchError } from './state.js';
let instance;
const upgradeLimits = createMongoRateLimitStore();
export function liveRuntime() {
    if (!liveConfigured()) throw new MatchError('Online matches need Redis and QStash configuration.', 503);
    if (!instance) { const infra = createLiveInfra(); instance = { infra, service: createMatchService({ infra }) }; }
    return instance;
}
export const liveRouter = express.Router();
liveRouter.post('/deadline', async (req, res) => {
    try {
        const { infra, service } = liveRuntime();
        if (!req.rawBody || typeof req.headers['upstash-signature'] !== 'string' || !await infra.verify(req.headers['upstash-signature'], req.rawBody)) return res.sendStatus(401);
        await service.deadline(req.body.gameId); res.sendStatus(204);
    } catch (error) { logger.error({ err: error, event: 'match_deadline_failed' }, 'Deadline callback failed'); res.status(error.status === 404 ? 204 : error.status || 503).end(); }
});
liveRouter.get('/:gameId', protectRoute, async (req, res) => {
    try { res.json(await liveRuntime().service.snapshot(req.params.gameId, String(req.user._id))); }
    catch (error) { res.status(error.status || 503).json({ error: error instanceof MatchError ? error.message : 'Could not load this match.' }); }
});
export function attachLiveSockets(server, { runtime = liveRuntime, connect = connectMongoDB, authenticate, originAllowed = allowedOrigin } = {}) {
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
    server.on('upgrade', async (request, socket, head) => {
        socket.on('error', () => {});
        const reject = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        try {
            const url = new URL(request.url, 'http://localhost');
            const matched = /^\/api\/live\/([a-f0-9]{24})\/socket$/i.exec(url.pathname);
            if (!matched) return reject('404 Not Found');
            if (!request.headers.origin || !originAllowed(request.headers.origin, request.headers.host)) return reject('403 Forbidden');
            const { service, infra } = runtime();
            let userId, expires;
            if (authenticate) ({ userId, expires } = await authenticate(request));
            else {
                const token = /(?:^|;\s*)jwt=([^;]+)/.exec(request.headers.cookie || '')?.[1];
                if (!token || token.length > 4096) return reject('401 Unauthorized');
                const decoded = jwt.verify(decodeURIComponent(token), process.env.JWT_SECRET, { algorithms: ['HS256'] });
                if (!decoded || typeof decoded !== 'object' || !/^[a-f0-9]{24}$/i.test(decoded.userId) ) return reject('401 Unauthorized');
                userId = decoded.userId; expires = decoded.exp * 1000;
                if (!Number.isFinite(expires)) return reject('401 Unauthorized');
                const bucket = await upgradeLimits.increment({ namespace: 'match-upgrade', identifier: userId, windowMs: 60_000, time: Date.now() });
                if (bucket.count > 30) return reject('429 Too Many Requests');
                if (!await User.exists({ _id: userId })) return reject('401 Unauthorized');
            }
            await connect();
            const id = matched[1], connection = randomUUID();
            const snapshot = await service.connection(id, userId, connection, true);
            if (socket.destroyed) { await service.connection(id, userId, connection, false); return; }
            sockets.handleUpgrade(request, socket, head, ws => {
                let closed = false, expired = false, rematchTimer, chain = Promise.resolve(), lastSeen = Date.now(), count = 0, windowStart = Date.now(), pingSent = 0, pingToken = '', bestRtt = Infinity;
                const send = value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
                const expireRematch = () => {
                    expired = true;
                    clearInterval(interval); clearTimeout(rotation);
                    ws.close(4002, 'Rematch window expired');
                };
                const snapshotMessage = value => {
                    send({ type: 'snapshot', data: value });
                    clearTimeout(rematchTimer);
                    if (value.rematchUntil != null) {
                        const remaining = value.rematchUntil - Date.now();
                        if (remaining <= 0) expireRematch();
                        else { rematchTimer = setTimeout(expireRematch, remaining); rematchTimer.unref(); }
                    }
                };
                const queue = task => { chain = chain.then(async () => { if (!closed && !expired) await task(); }).catch(error => {
                    logger.warn({ err: error, event: 'match_socket_error' }, 'Match connection operation failed');
                    send({ type: 'error', error: error instanceof MatchError ? error.message : 'Connection interrupted. Reconnecting.' });
                    if (!(error instanceof MatchError)) ws.close(1011, 'Service unavailable');
                }); };
                const unsubscribe = infra.subscribe(id, () => queue(async () => snapshotMessage(await service.snapshot(id, userId))), () => ws.close(1011, 'Broadcast interrupted'));
                const interval = setInterval(() => {
                    if (Date.now() >= expires) return ws.close(4001, 'Session expired');
                    if (Date.now() - lastSeen > 20_000) return ws.terminate();
                    pingSent = performance.now(); pingToken = randomUUID(); ws.ping(pingToken);
                }, 10_000);
                interval.unref();
                // Reconnect before Hobby's invocation limit; multiple tabs have independent leases.
                const rotation = setTimeout(() => ws.close(1012, 'Reconnect'), 270_000); rotation.unref();
                ws.on('pong', data => {
                    lastSeen = Date.now();
                    if (String(data) === pingToken) bestRtt = Math.min(bestRtt, performance.now() - pingSent);
                    // Browsers answer protocol pings even when background-tab JavaScript timers are throttled.
                    queue(async () => snapshotMessage(await service.connection(id, userId, connection, true)));
                });
                ws.on('message', raw => {
                    if (Date.now() >= expires) return ws.close(4001, 'Session expired');
                    if (Date.now() - windowStart > 10_000) { count = 0; windowStart = Date.now(); }
                    if (++count > 25) return ws.close(1008, 'Too many messages');
                    let message; try { message = JSON.parse(String(raw)); } catch { return ws.close(1007, 'Invalid JSON'); }
                    if (!message || typeof message !== 'object') return ws.close(1007, 'Invalid message');
                    lastSeen = Date.now();
                    queue(async () => {
                        if (message.type === 'heartbeat') snapshotMessage(await service.snapshot(id, userId));
                        else snapshotMessage(await service.command(id, userId, message, { lagMs: Number.isFinite(bestRtt) ? bestRtt / 2 : 0 }));
                    });
                });
                ws.on('error', () => ws.close());
                ws.on('close', () => {
                    closed = true; clearInterval(interval); clearTimeout(rotation); clearTimeout(rematchTimer); Promise.resolve(unsubscribe()).catch(() => {});
                    // Wait for in-flight commands before dropping only this connection's lease.
                    chain.then(() => service.connection(id, userId, connection, false)).catch(error => logger.warn({ err: error, event: 'match_disconnect_failed' }, 'Lease will expire automatically'));
                });
                snapshotMessage(snapshot);
            });
        } catch (error) { logger.warn({ err: error, event: 'match_upgrade_failed' }, 'Connection rejected'); reject(({ 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 429: '429 Too Many Requests', 503: '503 Service Unavailable' })[error.status] || '401 Unauthorized'); }
    });
    return sockets;
}
