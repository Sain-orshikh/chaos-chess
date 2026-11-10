import mongoose from 'mongoose';
import { randomInt } from 'node:crypto';
import Ticket from './model.js';
import Game from '../models/game.model.js';
import User from '../models/user.model.js';
import { MatchError } from '../live/state.js';
import { SEARCH_LEASE_MS, ratingRange, chooseOpponent, validQueue } from './policy.js';

export function createMatchmaker({ tickets = Ticket, games = Game, users = User, matches, transaction, now = Date.now, coin = () => randomInt(2) } = {}) {
    const transact = transaction || (async work => {
        const session = await mongoose.startSession();
        try { return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); }
        finally { await session.endSession(); }
    });
    function view(ticket, at) {
        if (!ticket) return { state: 'idle' };
        if (ticket.state === 'matched') return { state: 'matched', gameId: String(ticket.gameId), ruleset: ticket.ruleset };
        if (ticket.expiresAt <= at) return { state: 'idle' };
        return { state: 'queued', ruleset: ticket.ruleset, timeMs: ticket.timeMs, joinedAt: ticket.joinedAt, range: ratingRange(ticket.joinedAt, at), serverNow: at };
    }
    async function run(userId, action, config = {}) {
        if (action === 'join' && !validQueue(config.ruleset, config.timeMs)) throw new MatchError('Choose Havoc or Classic and a 5- or 10-minute clock.', 400);
        // The same IDs survive transaction retries; no duplicate game on an unknown commit outcome.
        const gameId = new mongoose.Types.ObjectId(), whiteFirst = coin() === 0;
        for (let attempt = 0; attempt < 3; attempt++) {
            try { return await transact(async session => {
                const at = now();
                let ticket = await tickets.findById(userId).session(session).lean();
                const active = await games.findOne({ status: 'playing', $or: [{ playerA: userId }, { playerB: userId }] }).session(session).lean();
                if (active) return { state: 'matched', gameId: String(active._id), ruleset: active.live.game.ruleset };
                // A rematch may have superseded the stored ticket. Active games always take precedence.
                if (ticket?.state === 'matched') { await tickets.deleteOne({ _id: userId }, { session }); ticket = null; }
                if (action === 'cancel') { await tickets.deleteOne({ _id: userId }, { session }); return { state: 'idle' }; }
                const connection = config.connection || 'internal';
                if (action === 'leave') {
                    if (ticket) await tickets.updateOne({ _id: userId }, { $set: { leases: (ticket.leases || []).filter(lease => lease.connection !== connection && lease.until > at) } }, { session });
                    return { state: 'idle' };
                }
                if (action === 'join') {
                    if (ticket && ticket.expiresAt > at && (ticket.ruleset !== config.ruleset || ticket.timeMs !== config.timeMs)) throw new MatchError('Cancel your current search before changing queues.', 409);
                    if (!ticket || ticket.expiresAt <= at) {
                        const user = await users.findById(userId).session(session).lean();
                        if (!user) throw new MatchError('Please sign in again.', 401);
                        ticket = { _id: userId, state: 'queued', ruleset: config.ruleset, timeMs: config.timeMs, rating: user.elo, joinedAt: at, expiresAt: at + SEARCH_LEASE_MS, gameId: null, leases: [] };
                        await tickets.replaceOne({ _id: userId }, ticket, { upsert: true, session });
                    }
                }
                if (!ticket || ticket.expiresAt <= at) return { state: 'idle' };
                ticket.expiresAt = at + SEARCH_LEASE_MS;
                ticket.leases = (ticket.leases || []).filter(lease => lease.until > at && lease.connection !== connection);
                if (ticket.leases.length >= 8) throw new MatchError('Close an extra matchmaking tab before continuing.', 409);
                ticket.leases.push({ connection, until: ticket.expiresAt });
                await tickets.updateOne({ _id: userId }, { $set: { expiresAt: ticket.expiresAt, leases: ticket.leases } }, { session });
                const range = ratingRange(ticket.joinedAt, at);
                const query = { state: 'queued', ruleset: ticket.ruleset, timeMs: ticket.timeMs, expiresAt: { $gt: at }, leases: { $elemMatch: { until: { $gt: at } } }, _id: { $ne: userId } };
                if (range !== null) query.rating = { $gte: ticket.rating - range, $lte: ticket.rating + range };
                const candidates = await tickets.find(query).sort({ joinedAt: 1, _id: 1 }).limit(128).session(session).lean();
                const opponent = chooseOpponent(ticket, candidates, at);
                if (!opponent) return view(ticket, at);
                const self = await users.findById(userId).session(session).lean();
                const other = await users.findById(opponent._id).session(session).lean();
                if (!self || !other) { if (!other) await tickets.deleteOne({ _id: opponent._id }, { session }); return view(ticket, at); }
                const otherActive = await games.findOne({ status: 'playing', $or: [{ playerA: opponent._id }, { playerB: opponent._id }] }).session(session).lean();
                if (otherActive) { await tickets.deleteOne({ _id: opponent._id }, { session }); return view(ticket, at); }
                // These two writes conflict with another pairing, cancel or rematch touching either account.
                for (const id of [userId, opponent._id]) await tickets.updateOne({ _id: id }, { $set: { state: 'matched', gameId } }, { session });
                await matches.create({ id: gameId, white: whiteFirst ? self : other, black: whiteFirst ? other : self,
                    ruleset: ticket.ruleset, timeMs: ticket.timeMs, incrementMs: 0, rated: true, session });
                return { state: 'matched', gameId: String(gameId), ruleset: ticket.ruleset };
            }); } catch (error) { if (error.code === 11000 && attempt < 2) continue; throw error; }
        }
    }
    return { run,
        async counts() {
            const at = now();
            const rows = await tickets.aggregate([{ $match: { state: 'queued', expiresAt: { $gt: at }, leases: { $elemMatch: { until: { $gt: at } } } } }, { $group: { _id: { ruleset: '$ruleset', timeMs: '$timeMs' }, count: { $sum: 1 } } }]);
            return rows.map(row => ({ ...row._id, count: row.count }));
        },
    };
}
