import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createLeaderboardService, createMongoLeaderboardStore, publicEntries, topUsers, REFRESH_MS, MAX_AGE_MS } from "../backend/leaderboard/service.js";
import { createApp } from "../backend/server.js";

const user = (id, elo = 500) => ({ _id: id, username: `player_${id}`, elo, matches: 5, wins: 0, password: "secret", googleId: "private" });
function memoryStore(initial) {
    let document = initial;
    let publishes = 0;
    return {
        read: async () => document && structuredClone(document),
        initialize: async () => { document ||= { generatedAt: null, entries: [], nextRefreshAt: 0, nextAttemptAt: 0, leaseUntil: 0, leaseOwner: "" }; },
        acquire: async (time, owner) => {
            if (document.leaseUntil > time || document.nextRefreshAt > time || document.nextAttemptAt > time) return null;
            document.leaseOwner = owner; document.leaseUntil = time + 15_000;
            return structuredClone(document);
        },
        publish: async (owner, time, entries) => {
            if (document.leaseOwner !== owner || document.leaseUntil <= time) return false;
            Object.assign(document, { generatedAt: time, entries, nextRefreshAt: time + REFRESH_MS, nextAttemptAt: 0, leaseUntil: 0, leaseOwner: "" });
            publishes++;
            return true;
        },
        failed: async (owner, time) => {
            if (document.leaseOwner === owner) Object.assign(document, { leaseUntil: 0, leaseOwner: "", nextAttemptAt: time + 60_000 });
        },
        get publishes() { return publishes; },
    };
}
const seed = time => ({ generatedAt: time, entries: publicEntries([user("existing", 800)]), nextRefreshAt: time + REFRESH_MS, nextAttemptAt: 0, leaseUntil: 0, leaseOwner: "" });

test("five completed matches qualify; lower counts are excluded without rank gaps; private fields never leave projection", () => {
    const entries = publicEntries([{ ...user("new", 2000), matches: 0 }, { ...user("almost", 1500), matches: 4 }, user("a", 900), user("b", 900), user("c", 500)]);
    assert.deepEqual(entries.map(entry => entry.rank), [1, 1, 3]);
    assert.equal(entries[2].matches, 5);
    assert.deepEqual(entries.map(entry => entry.userId), ["a", "b", "c"]);
    assert.deepEqual(Object.keys(entries[0]).sort(), ["elo", "matches", "name", "rank", "userId", "username", "wins"]);
    assert.throws(() => publicEntries(Array.from({ length: 101 }, () => user("a"))), /entry limit/);
    assert.throws(() => publicEntries([{ ...user("a"), wins: 6 }]), /statistics/);
});

test("Mongo filters eligibility before the top-100 limit and uses the eligible rating index", async () => {
    const calls = [];
    const query = Object.fromEntries(["select", "sort", "hint", "limit", "maxTimeMS"].map(method => [method, value => { calls.push([method, value]); return query; }]));
    query.lean = async () => [];
    await topUsers({ init: async () => {}, find: filter => { calls.push(["find", filter]); return query; } });
    assert.deepEqual(calls[0], ["find", { matches: { $gte: 5 } }]);
    assert.ok(calls.some(([method, value]) => method === "hint" && value === "leaderboard_eligible_elo"));
    assert.ok(calls.some(([method, value]) => method === "limit" && value === 100));
});

test("independent instances coordinate one cold refresh and serve a warm snapshot without another ranking query", async () => {
    let queries = 0, release;
    const wait = new Promise(resolve => { release = resolve; });
    const store = memoryStore();
    const options = { store, connect: async () => {}, now: () => 1_000_000, query: async () => { queries++; await wait; return [user("a")]; } };
    const first = createLeaderboardService(options).read();
    // Let the winner enter its slow query before another instance arrives.
    while (!queries) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(createLeaderboardService(options).read(), { status: 503 });
    release();
    const value = await first;
    assert.equal(queries, 1); assert.equal(store.publishes, 1);
    assert.deepEqual(await createLeaderboardService(options).read(), value);
    assert.equal(queries, 1);
});

test("expired snapshots refresh on demand; concurrent visitors retain last standings", async () => {
    let queries = 0, release;
    const wait = new Promise(resolve => { release = resolve; });
    const store = memoryStore(seed(1000));
    const options = { store, connect: async () => {}, now: () => REFRESH_MS + 1001, query: async () => { queries++; await wait; return [user("new", 1000)]; } };
    const first = createLeaderboardService(options).read();
    while (!queries) await new Promise(resolve => setImmediate(resolve));
    const old = await createLeaderboardService(options).read();
    assert.equal(old.entries[0].userId, "existing"); assert.equal(old.generatedAt, 1000);
    release(); assert.equal((await first).entries[0].userId, "new");
    assert.equal(queries, 1);
});

test("failed refresh retains timestamp and backs off globally; ancient data is unavailable", async () => {
    const store = memoryStore(seed(1000)); let queries = 0; let time = REFRESH_MS + 1001;
    const options = { store, connect: async () => {}, now: () => time, query: async () => { queries++; throw new Error("offline"); } };
    assert.equal((await createLeaderboardService(options).read()).generatedAt, 1000);
    await createLeaderboardService(options).read(); assert.equal(queries, 1);
    time += 60_001;
    await createLeaderboardService(options).read(); assert.equal(queries, 2);
    time = MAX_AGE_MS + 1001;
    await assert.rejects(createLeaderboardService(options).read(), { status: 503 });
});

test("a worker that outlives its lease cannot overwrite a newer snapshot", async () => {
    const store = memoryStore(seed(1000)); let time = REFRESH_MS + 1001; let release;
    const wait = new Promise(resolve => { release = resolve; }); let started;
    const ready = new Promise(resolve => { started = resolve; });
    const old = createLeaderboardService({ store, connect: async () => {}, now: () => time, owner: () => "old", query: async () => { started(); await wait; return [user("old")]; } }).read();
    await ready; time += 15_001;
    await createLeaderboardService({ store, connect: async () => {}, now: () => time, owner: () => "new", query: async () => [user("new")] }).read();
    release(); assert.equal((await old).entries[0].userId, "new"); assert.equal(store.publishes, 1);
});

test("an already-read stale snapshot survives loss of the database during refresh", async () => {
    const store = memoryStore(seed(1000));
    const read = store.read;
    let reads = 0;
    store.read = async () => { if (++reads > 1) throw new Error("database offline"); return read(); };
    const service = createLeaderboardService({ store, connect: async () => {}, now: () => REFRESH_MS + 1001,
        query: async () => { throw new Error("database offline"); } });
    assert.equal((await service.read()).generatedAt, 1000);
});

test("Mongo adapter fences publication by owner and unexpired lease, and tolerates singleton creation races", async () => {
    let filter, update;
    const store = createMongoLeaderboardStore({
        updateOne: async (query, change, options) => {
            if (options?.upsert) throw Object.assign(new Error("race"), { code: 11000 });
            filter = query; update = change; return { modifiedCount: 0 };
        },
    });
    await store.initialize();
    assert.equal(await store.publish("owner", 1000, []), false);
    assert.deepEqual(filter, { _id: "global:v3", leaseOwner: "owner", leaseUntil: { $gt: 1000 } });
    assert.equal(update.$set.nextRefreshAt, REFRESH_MS + 1000);
});

test("public HTTP route bypasses account middleware, never personalizes, and rejects query variants before any data access", async () => {
    let reads = 0;
    const app = createApp({ connect: async () => { throw new Error("Account middleware must not run"); },
        limiterStore: { increment: () => assert.fail("No rate-limit write for public rankings") },
        leaderboard: { service: { read: async () => { reads++; return { generatedAt: Date.now(), entries: [] }; } } },
    });
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/leaderboard`;
    try {
        for (const headers of [{}, { Cookie: "jwt=someone", Origin: "https://arbitrary.example" }]) {
            const response = await fetch(base, { headers });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "public, max-age=30");
            assert.match(response.headers.get("vercel-cdn-cache-control"), /s-maxage=60/);
            assert.equal(response.headers.get("set-cookie"), null);
            assert.equal(response.headers.get("vary"), null);
            assert.equal(response.headers.get("ratelimit-limit"), null);
            assert.equal(response.headers.get("access-control-allow-origin"), null);
        }
        assert.equal(reads, 2);
        for (const suffix of ["?limit=1000", "/unknown", "/"]) {
            const response = await fetch(base + suffix);
            assert.ok([400, 404].includes(response.status));
            assert.equal(response.headers.get("cache-control"), "no-store");
        }
        assert.equal((await fetch(base, { method: "POST" })).status, 405);
        assert.equal(reads, 2);
        assert.equal((await fetch(base, { method: "HEAD" })).status, 200);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("public HTTP failures are not cached and advertise retry backoff", async () => {
    const app = createApp({ leaderboard: { service: { read: async () => { throw new Error("offline"); } } } });
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/leaderboard`);
        assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("vercel-cdn-cache-control"), null); assert.equal(response.headers.get("retry-after"), "60");
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("browser downloads are deduplicated, public, and expire with the server snapshot rather than five minutes after download", async () => {
    const { readLeaderboard } = await import("../src/lib/leaderboard.ts?freshness-test");
    const originalFetch = globalThis.fetch, originalNow = Date.now;
    let time = 1_000_000, calls = 0, finish;
    Date.now = () => time;
    globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "/api/leaderboard"); assert.equal(options.credentials, "omit");
        assert.equal(options.headers, undefined); assert.equal(options.cache, undefined);
        await new Promise(resolve => { finish = resolve; });
        return new Response(JSON.stringify({ generatedAt: time - 290_000, entries: [] }), { headers: { "Content-Type": "application/json" } });
    };
    try {
        const first = readLeaderboard(), other = readLeaderboard();
        assert.equal(calls, 1); finish(); await Promise.all([first, other]);
        await readLeaderboard(); assert.equal(calls, 1);
        time += 10_001;
        const refreshed = readLeaderboard(); assert.equal(calls, 2); finish(); await refreshed;
    } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("browser failures respect shared retry backoff and preserve the last successful snapshot", async () => {
    const { readLeaderboard, retainedLeaderboard } = await import("../src/lib/leaderboard.ts?backoff-test");
    const originalFetch = globalThis.fetch, originalNow = Date.now;
    let time = 1_000_000, calls = 0;
    Date.now = () => time;
    globalThis.fetch = async () => {
        calls++;
        return calls === 1 ? new Response(JSON.stringify({ generatedAt: time, entries: [] })) : new Response("unavailable", { status: 503, headers: { "Retry-After": "60" } });
    };
    try {
        await readLeaderboard(); time += REFRESH_MS + 1;
        await assert.rejects(readLeaderboard()); await assert.rejects(readLeaderboard());
        assert.equal(calls, 2); assert.equal(retainedLeaderboard().generatedAt, 1_000_000);
        time += 60_001; await assert.rejects(readLeaderboard()); assert.equal(calls, 3);
    } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});
