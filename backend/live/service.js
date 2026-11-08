import mongoose from 'mongoose';
import Game from '../models/game.model.js';
import { finalizeGame } from '../controllers/user.controller.js';
import { logger } from '../logging/logger.js';
import { initialMatch, settle, transition, presence, publicMatch, MatchError } from './state.js';
import MatchTicket from '../matchmaking/model.js';
export function member(document, userId) {
    if (String(document.playerA) === String(userId)) return 'white';
    if (String(document.playerB) === String(userId)) return 'black';
    throw new MatchError('You are not a player in this match.', 403);
}
export function createMatchService({ model = Game, infra, now = Date.now, finalize = finalizeGame } = {}) {
    async function read(id) {
        if (!/^[a-f0-9]{24}$/i.test(id)) throw new MatchError('Invalid match ID.', 400);
        const document = await model.findById(id).lean();
        if (!document?.live) throw new MatchError('Match not found.', 404);
        return document;
    }
    async function complete(document) {
        if (document.status !== 'finished' || !document.rated || document.finalizedAt) return;
        let code, body;
        try { await finalize({ body: {}, params: { gameId: String(document._id) }, user: { _id: document.playerA }, log: logger }, {
            status(value) { code = value; return this; }, json(value) { body = value; },
        });
        if (code !== 200) throw new Error(body?.error || 'Rating finalization failed.');
        return true;
        } catch (error) { logger.warn({ err: error, event: 'match_rating_pending' }, 'Match ended; durable callback will retry ratings'); return false; }
    }
    async function ensureDeadline(document, at) {
        // A durable callback is installed BEFORE committing. A crash never leaves an accepted state without a wakeup.
        // Finished rated games also get a retry wakeup until their rating transaction succeeds.
        if (!document.live.outcome || (document.rated && !document.finalizedAt)) {
            const clock = document.live.turnStartedAt + document.live.clocks[document.live.game.turn];
            await infra.schedule(String(document._id), Math.max(at + 1000, Math.min((Math.floor(at / 20_000) + 1) * 20_000, document.live.outcome ? Infinity : clock)));
        }
    }
    async function update(id, userId, operation) {
        for (let attempt = 0; attempt < 6; attempt++) {
            const document = await read(id), at = now();
            const color = userId ? member(document, userId) : null;
            let state = structuredClone(document.live);
            if (!settle(state, at) && operation) state = operation(state, color, at, document);
            state.version = document.live.version + 1;
            const next = { ...document, live: state };
            if (state.outcome) {
                next.status = 'finished'; next.result = state.outcome.result === 'white' ? 'a' : state.outcome.result === 'black' ? 'b' : state.outcome.result;
                if (state.outcome.result === null) next.rated = false;
            }
            await ensureDeadline(next, at);
            const saved = await model.findOneAndUpdate({ _id: id, 'live.version': document.live.version }, { $set: { live: state, status: next.status, result: next.result, rated: next.rated } }, { new: true }).lean();
            if (!saved) continue;
            // Pub/sub is only a hint; every heartbeat/reconnect also reads the durable snapshot.
            try { await infra.publish(id); } catch (error) { logger.warn({ err: error, event: 'match_publish_failed' }, 'Match saved; broadcast will recover on heartbeat'); }
            await complete(saved);
            return saved;
        }
        throw new MatchError('The match is busy. Please try again.');
    }
    return {
        // Trusted matchmaking boundary only. No public route accepts players, ratings or starting positions.
        async create({ white, black, ruleset, timeMs = 300_000, incrementMs = 0, rated = true, id = new mongoose.Types.ObjectId(), session }) {
            if (String(white._id) === String(black._id) || !['normal', 'chaos'].includes(ruleset) || !Number.isSafeInteger(timeMs) || timeMs < 30_000 || timeMs > 86_400_000 || !Number.isSafeInteger(incrementMs) || incrementMs < 0 || incrementMs > 60_000) throw new MatchError('Invalid match configuration.', 400);
            const document = { _id: id, playerA: white._id, playerB: black._id, rated, status: 'playing', result: null, finalizedAt: null,
                players: { white: player(white), black: player(black) }, live: initialMatch(ruleset, timeMs, incrementMs, now()) };
            await ensureDeadline(document, now());
            if (session) return (await model.create([document], { session }))[0];
            return model.create(document);
        },
        async snapshot(id, userId) { let document = await read(id); const color = member(document, userId); const probe = structuredClone(document.live); if (settle(probe, now())) document = await update(id, userId); else if (await complete(document)) document = await read(id); return publicMatch(document, color, now()); },
        async command(id, userId, command, { lagMs = 0 } = {}) {
            const document = await update(id, userId, (state, color, at) => {
                const next = transition(state, color, command, at, lagMs);
                if (command.type === 'accept-rematch' && !next.nextGameId) next.nextGameId = String(new mongoose.Types.ObjectId());
                return next;
            });
            if (document.live.nextGameId) {
                const old = await read(id);
                const next = { _id: old.live.nextGameId, playerA: old.playerB, playerB: old.playerA, rated: old.rated, status: 'playing',
                    players: { white: { ...old.players.black, rating: old.ratings?.b?.after ?? old.players.black.rating }, black: { ...old.players.white, rating: old.ratings?.a?.after ?? old.players.white.rating } }, live: initialMatch(old.live.game.ruleset, old.live.timeMs, old.live.incrementMs, now()) };
                // Deterministic reserved ID + upsert makes rematch retries and concurrent accepts harmless.
                await ensureDeadline(next, now());
                if (model === Game) {
                    const session = await mongoose.startSession();
                    try {
                        await session.withTransaction(async () => {
                            // Rematches share the queue's per-account locks. Joining another queue
                            // while accepting a rematch cannot create two active matches.
                            for (const userId of [next.playerA, next.playerB].sort((a, b) => String(a).localeCompare(String(b)))) {
                                const active = await model.findOne({ _id: { $ne: next._id }, status: 'playing', $or: [{ playerA: userId }, { playerB: userId }] }).session(session);
                                if (active) throw new MatchError('A player has already joined another match.', 409);
                                await MatchTicket.replaceOne({ _id: userId }, { _id: userId, state: 'matched', gameId: next._id,
                                    ruleset: next.live.game.ruleset, timeMs: next.live.timeMs, rating: 0, joinedAt: now(), expiresAt: now() }, { upsert: true, session });
                            }
                            await model.updateOne({ _id: next._id }, { $setOnInsert: next }, { upsert: true, session });
                        });
                    } finally { await session.endSession(); }
                } else await model.updateOne({ _id: next._id }, { $setOnInsert: next }, { upsert: true });
                await update(id, userId, state => ({ ...state, nextGameReady: true }));
            }
            return publicMatch(await read(id), member(document, userId), now());
        },
        async connection(id, userId, connectionId, connected) { const document = await update(id, userId, (state, color, at) => presence(state, color, connectionId, connected, at)); return publicMatch(document, member(document, userId), now()); },
        async deadline(id) { return update(id, null); },
    };
}
function player(user) { return { name: user.displayName || user.username, image: user.profileImg || '', rating: user.elo }; }
