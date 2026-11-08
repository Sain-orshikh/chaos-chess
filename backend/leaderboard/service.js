import { randomUUID } from "node:crypto";
import Snapshot from "../models/leaderboardSnapshot.model.js";
import User from "../models/user.model.js";
import connectMongoDB from "../db/connectMongoDB.js";
import { leaderboardAwards, equippedBadges } from '../badges/rules.js';

export const REFRESH_MS = 300_000;
export const MAX_AGE_MS = 86_400_000;
export const MIN_MATCHES = 5;
const KEY = "global:v3";
const LEASE_MS = 15_000;

export function createMongoLeaderboardStore(model = Snapshot, userModel = User) {
    return {
        read: () => model.findById(KEY).lean(),
        async initialize() {
            try {
                await model.updateOne({ _id: KEY }, { $setOnInsert: {
                    generatedAt: null, entries: [], nextRefreshAt: 0, nextAttemptAt: 0,
                    leaseUntil: 0, leaseOwner: "",
                } }, { upsert: true });
            } catch (error) { if (error.code !== 11000) throw error; }
        },
        acquire: (time, owner) => model.findOneAndUpdate({ _id: KEY,
            nextRefreshAt: { $lte: time }, nextAttemptAt: { $lte: time }, leaseUntil: { $lte: time },
        }, { $set: { leaseOwner: owner, leaseUntil: time + LEASE_MS } }, { returnDocument: "after" }).lean(),
        async publish(owner, time, entries, awards = []) {
            const filter = { _id: KEY, leaseOwner: owner, leaseUntil: { $gt: time } };
            const update = {
                $set: { entries, generatedAt: time, nextRefreshAt: time + REFRESH_MS,
                    leaseUntil: 0, leaseOwner: "", nextAttemptAt: 0 },
            };
            // Most refreshes have no new awards and retain the original single
            // publication write. New awards commit with the snapshot or neither.
            if (!awards.length) return (await model.updateOne(filter, update)).modifiedCount === 1;
            return model.db.transaction(async session => {
                const result = await model.updateOne(filter, update, { session });
                if (result.modifiedCount !== 1) return false;
                await userModel.bulkWrite(awards, { session, ordered: true });
                return true;
            }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        },
        async failed(owner, time) {
            await model.updateOne({ _id: KEY, leaseOwner: owner }, {
                $set: { leaseUntil: 0, leaseOwner: "", nextAttemptAt: time + 60_000 },
            });
        },
    };
}

export async function topUsers(model = User) {
    // Mongoose reuses the model's initialization promise. Do not sort before its
    // index is ready; a missing index must fail rather than scan all accounts.
    await model.init();
    return model.find({ matches: { $gte: MIN_MATCHES } }).select("_id username displayName elo matches wins profileImg equippedBadges badges")
        .sort({ elo: -1, _id: 1 }).hint("leaderboard_eligible_elo").limit(100).maxTimeMS(2000).lean();
}

export function publicEntries(users) {
    if (users.length > 100) throw new Error("Leaderboard exceeds entry limit");
    let rank = 0;
    const eligible = users.filter(user => user.matches >= MIN_MATCHES);
    const entries = eligible.map((user, index) => {
        if (![user.elo, user.matches, user.wins].every(Number.isSafeInteger) || user.matches < 0 || user.wins < 0 || user.wins > user.matches) throw new Error("Invalid leaderboard statistics");
        if (!index || user.elo !== eligible[index - 1].elo) rank = index + 1;
        return {
            userId: String(user._id), username: String(user.username).slice(0, 100),
            name: String(user.displayName || user.username).slice(0, 100),
            elo: user.elo, matches: user.matches, wins: user.wins, rank,
            profileImg: typeof user.profileImg === 'string' && user.profileImg.length <= 512 ? user.profileImg : '',
            equippedBadges: equippedBadges(user),
        };
    });
    // Bound image URLs and badge IDs above; include room for the new public
    // display fields without any additional per-player database requests.
    if (Buffer.byteLength(JSON.stringify(entries)) > 128_000) throw new Error("Leaderboard exceeds payload budget");
    return entries;
}

function result(snapshot, time) {
    if (snapshot?.generatedAt == null || time - snapshot.generatedAt > MAX_AGE_MS) {
        throw Object.assign(new Error("Standings are temporarily unavailable. Please try again shortly."), { status: 503 });
    }
    return { generatedAt: snapshot.generatedAt, entries: snapshot.entries };
}

export function createLeaderboardService({ store = createMongoLeaderboardStore(), query = topUsers,
    connect = connectMongoDB, now = Date.now, owner = randomUUID, log } = {}) {
    return {
        async read() {
            await connect();
            let snapshot = await store.read();
            const time = now();
            if (snapshot?.generatedAt != null && snapshot.nextRefreshAt > time) return result(snapshot, time);
            if (!snapshot) { await store.initialize(); snapshot = await store.read(); }
            // Avoid even a lease write while a refresh/backoff is in progress.
            if (snapshot.leaseUntil > time || snapshot.nextAttemptAt > time) return result(snapshot, time);
            const token = owner();
            const lease = await store.acquire(time, token);
            if (!lease) return result(await store.read().catch(() => snapshot), now());
            try {
                const users = await query();
                const entries = publicEntries(users);
                const generatedAt = now();
                const awards = leaderboardAwards(users, entries, new Date(generatedAt));
                if (await store.publish(token, generatedAt, entries, awards)) return { generatedAt, entries };
            } catch (error) {
                log?.warn({ err: error, event: "leaderboard_refresh_failed" }, "Leaderboard refresh failed");
                // Failure bookkeeping must never prevent a readable stale response.
                await store.failed(token, now()).catch(() => {});
            }
            return result(await store.read().catch(() => snapshot), now());
        },
    };
}
