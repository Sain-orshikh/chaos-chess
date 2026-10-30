import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createMongoConnector } from "../backend/db/connectMongoDB.js";
import { createMongoRateLimitStore, createMemoryRateLimitStore } from "../backend/security/rateLimitStore.js";
import { rateLimit, clientIp } from "../backend/security/rateLimit.js";
import { createLogger, serializeError } from "../backend/logging/logger.js";
import { allowedOrigin } from "../backend/config/cors.js";
import { createApp } from "../backend/server.js";

function response() {
    return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}

function captureLogger() {
    const lines = [];
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    const logger = createLogger({ write(line) { lines.push(JSON.parse(line)); } });
    if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous;
    return { logger, lines };
}

test("MongoDB connection initialization is shared by concurrent requests and warm calls", async () => {
    let calls = 0, finish;
    const client = { connection: { readyState: 0 }, connect: () => { calls++; return new Promise(resolve => { finish = () => { client.connection.readyState = 1; resolve(client); }; }); } };
    const connect = createMongoConnector(client, () => "mongodb://test-only");
    const pending = [connect(), connect(), connect()];
    assert.equal(calls, 1); finish();
    assert.deepEqual(await Promise.all(pending), [client, client, client]);
    await connect(); assert.equal(calls, 1);
    client.connection.readyState = 0;
    const next = connect(); assert.equal(calls, 2); finish(); await next;
});

test("a failed database connection can retry without exiting the function", async () => {
    let calls = 0;
    const client = { connection: { readyState: 0 }, connect: async () => { calls++; if (calls === 1) throw new Error("offline"); client.connection.readyState = 1; return client; } };
    const connect = createMongoConnector(client, () => "mongodb://test-only");
    await assert.rejects(connect(), /offline/);
    assert.equal(await connect(), client); assert.equal(calls, 2);
});

test("independent API instances share atomic MongoDB rate limit windows", async () => {
    const buckets = new Map();
    const model = { async findOneAndUpdate(query, update) {
        const bucket = buckets.get(query._id) || { count: 0, ...update.$setOnInsert };
        bucket.count += update.$inc.count;
        buckets.set(query._id, bucket);
        return { ...bucket };
    } };
    const a = createMongoRateLimitStore({ model, connect: async () => {} });
    const b = createMongoRateLimitStore({ model, connect: async () => {} });
    const input = { namespace: "auth", identifier: "203.0.113.5", windowMs: 60_000, time: 1000 };
    const results = await Promise.all([a.increment(input), b.increment(input), a.increment(input)]);
    assert.deepEqual(results.map(item => item.count).sort(), [1, 2, 3]);
    assert.equal(results[0].reset, 60_000);
    assert.equal(buckets.size, 1);
    assert.ok(![...buckets.keys()][0].includes(input.identifier));
    assert.equal([...buckets.values()][0].expiresAt.getTime(), 60_000);
    assert.equal((await b.increment({ ...input, time: 60_000 })).count, 1);
    assert.equal((await b.increment({ ...input, namespace: "profile-update" })).count, 1);
});

test("a concurrent counter creation race retries its increment once", async () => {
    let calls = 0;
    const store = createMongoRateLimitStore({ connect: async () => {}, model: { async findOneAndUpdate(_query, update, options) {
        calls++;
        if (calls === 1) { assert.equal(options.upsert, true); throw Object.assign(new Error("race"), { code: 11000 }); }
        assert.deepEqual(update, { $inc: { count: 1 } }); return { count: 2 };
    } } });
    const result = await store.increment({ namespace: "auth", identifier: "test", windowMs: 60_000, time: 1000 });
    assert.equal(result.count, 2); assert.equal(calls, 2);
});

test("rate limit storage failure fails closed with 503", async () => {
    const limiter = rateLimit({ limit: 1, windowMs: 1000, store: { async increment() { throw new Error("offline"); } } });
    const res = response(); await limiter({ ip: "client" }, res, () => assert.fail("must not allow unchecked requests"));
    assert.equal(res.statusCode, 503); assert.equal(res.headers["Retry-After"], 5);
});

test("client forwarding headers are trusted only on Vercel", () => {
    const previous = process.env.VERCEL;
    try {
        delete process.env.VERCEL;
        const req = { ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.10", "x-vercel-forwarded-for": "203.0.113.11" } };
        assert.equal(clientIp(req), "127.0.0.1");
        process.env.VERCEL = "1";
        assert.equal(clientIp(req), "203.0.113.11");
        assert.equal(clientIp({ ...req, headers: { "x-forwarded-for": "not-an-IP" } }), "127.0.0.1");
    } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test("preview CORS accepts its own host but not other Vercel projects", () => {
    const previous = process.env.VERCEL; process.env.VERCEL = "1";
    try {
        assert.equal(allowedOrigin("https://chaos-test.vercel.app", "chaos-test.vercel.app"), true);
        assert.equal(allowedOrigin("https://unrelated.vercel.app", "chaos-test.vercel.app"), false);
        assert.equal(allowedOrigin("https://chaos-test.vercel.app.attacker.test", "chaos-test.vercel.app"), false);
    } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test("structured errors include Cloudinary status and redact secrets and image data", () => {
    const previous = process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_API_SECRET = "private-test-secret";
    try {
        const error = serializeError({ message: "cloud_name mismatch private-test-secret data:image/png;base64,AAAA", http_code: 401 });
        assert.equal(error.httpCode, 401); assert.match(error.message, /cloud_name mismatch/); assert.ok(!error.message.includes("private-test-secret")); assert.ok(!error.message.includes("AAAA"));
        const { logger, lines } = captureLogger();
        logger.error({ err: { message: "cloud_name mismatch", http_code: 401 }, password: "never-log-this", token: "never-log-this" }, "Upload failed");
        assert.equal(lines[0].err.httpCode, 401); assert.equal(lines[0].password, "[Redacted]"); assert.equal(lines[0].token, "[Redacted]");
    } finally { if (previous === undefined) delete process.env.CLOUDINARY_API_SECRET; else process.env.CLOUDINARY_API_SECRET = previous; }
});

test("HTTP logging records request IDs, status, duration and path without credentials or query data", async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({ connect: async () => {}, log: logger, limiterStore: createMemoryRateLimitStore() });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        const url = `http://127.0.0.1:${server.address().port}`;
        const res = await fetch(`${url}/api/health?token=private-query`, { headers: { Cookie: "jwt=private-cookie", Authorization: "Bearer private-token", "X-Request-Id": "client-supplied-id" } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
        assert.equal(res.headers.get("cache-control"), "private, no-store");
        await res.text();
        const entry = lines.find(line => line.msg === "Request completed");
        assert.ok(entry); assert.equal(entry.req.path, "/api/health"); assert.equal(entry.res.statusCode, 200); assert.equal(typeof entry.responseTime, "number");
        assert.equal(entry.reqId, res.headers.get("x-request-id"));
        assert.ok(!JSON.stringify(lines).includes("private-query")); assert.ok(!JSON.stringify(lines).includes("private-cookie")); assert.ok(!JSON.stringify(lines).includes("private-token"));
        const unauthorized = await fetch(`${url}/api/auth/me`); assert.equal(unauthorized.status, 401); await unauthorized.text();
        const invalid = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: { $ne: null }, password: "private-request-password" }) });
        assert.equal(invalid.status, 400); await invalid.text();
        assert.ok(!JSON.stringify(lines).includes("private-request-password"));
    } finally { await new Promise(resolve => server.close(resolve)); }
});
