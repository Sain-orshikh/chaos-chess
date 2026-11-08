// Transactional test adapter: isolated from real Mongo/Redis/QStash.
import { memory, infra } from './live-support.mjs';
import { createMatchService } from '../../backend/live/service.js';
import { createMatchmaker } from '../../backend/matchmaking/service.js';
function matches(doc, query) {
    return Object.entries(query).every(([key, value]) => {
        if (key === '$or') return value.some(part => matches(doc, part));
        const actual = doc[key];
        if (value?.$elemMatch) return Array.isArray(actual) && actual.some(item => matches(item, value.$elemMatch));
        if (value && typeof value === 'object' && !value.toHexString) return Object.entries(value).every(([op, target]) => op === '$ne' ? String(actual) !== String(target) : op === '$gt' ? actual > target : op === '$gte' ? actual >= target : op === '$lte' ? actual <= target : false);
        return String(actual) === String(value);
    });
}
function query(get) {
    let order, cap;
    return { session() { return this; }, sort(value) { order = value; return this; }, limit(value) { cap = value; return this; },
        async lean() { let result = get(); if (Array.isArray(result)) { if (order) result.sort((a, b) => { for (const key of Object.keys(order)) { const c = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (c) return c; } return 0; }); if (cap) result = result.slice(0, cap); } return structuredClone(result); } };
}
export function queueFixture({ coin = () => 0 } = {}) {
    const db = memory(), bus = infra(), tickets = new Map(), users = new Map();
    let time = Date.now(), chain = Promise.resolve();
    const games = { findOne(filter) { return query(() => [...db.docs.values()].find(doc => matches(doc, filter)) || null); } };
    const model = {
        findById(id) { return query(() => tickets.get(String(id)) || null); },
        find(filter) { return query(() => [...tickets.values()].filter(doc => matches(doc, filter))); },
        async deleteOne(filter) { tickets.delete(String(filter._id)); },
        async replaceOne(filter, doc) { tickets.set(String(filter._id), structuredClone(doc)); },
        async updateOne(filter, update) { const old = tickets.get(String(filter._id)); if (old) Object.assign(old, structuredClone(update.$set)); },
        async aggregate() { const counts = new Map(); for (const row of tickets.values()) if (row.state === 'queued' && row.expiresAt > time && row.leases.some(lease => lease.until > time)) { const key = `${row.ruleset}:${row.timeMs}`; const entry = counts.get(key) || { _id: { ruleset: row.ruleset, timeMs: row.timeMs }, count: 0 }; entry.count++; counts.set(key, entry); } return [...counts.values()]; },
    };
    const transaction = work => {
        const result = chain.then(async () => {
            const beforeTickets = structuredClone(tickets), beforeGames = structuredClone(db.docs);
            try { return await work({ fixture: true }); }
            catch (error) { tickets.clear(); for (const [id, doc] of beforeTickets) tickets.set(id, doc); db.docs.clear(); for (const [id, doc] of beforeGames) db.docs.set(id, doc); throw error; }
        });
        chain = result.catch(() => {}); return result;
    };
    const service = createMatchService({ model: db.model, infra: bus, now: () => time, finalize: async (_req, res) => res.status(200).json({}) });
    const matchmaking = createMatchmaker({ tickets: model, games, users: { findById(id) { return query(() => users.get(String(id)) || null); } }, matches: service, transaction, now: () => time, coin });
    return { db, bus, tickets, users, service, matchmaking, advance(ms) { time += ms; },
        add(id, elo = 1200, name = id.slice(0, 4)) { const user = { _id: id, username: name, elo }; users.set(id, user); return user; },
    };
}
