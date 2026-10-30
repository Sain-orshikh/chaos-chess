import { createHash } from "node:crypto";
import RateLimit from "../models/rateLimit.model.js";
import connectMongoDB from "../db/connectMongoDB.js";

export function createMongoRateLimitStore({ model = RateLimit, connect = connectMongoDB } = {}) {
    return {
        async increment({ namespace, identifier, windowMs, time }) {
            await connect();
            const start = Math.floor(time / windowMs) * windowMs;
            const reset = start + windowMs;
            const hash = createHash("sha256").update(JSON.stringify([namespace, identifier, windowMs, start])).digest("hex");
            const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(reset) } };
            let bucket;
            try {
                bucket = await model.findOneAndUpdate({ _id: hash }, update, { upsert: true, returnDocument: "after", setDefaultsOnInsert: false });
            } catch (error) {
                // Two instances may race to create a window. Only retry a known duplicate-key failure.
                if (error.code !== 11000) throw error;
                bucket = await model.findOneAndUpdate({ _id: hash }, { $inc: { count: 1 } }, { returnDocument: "after" });
            }
            if (!bucket) throw new Error("Rate limit counter was not available");
            return { count: bucket.count, reset };
        },
    };
}

export function createMemoryRateLimitStore() {
    const buckets = new Map();
    let nextSweep = 0;
    return {
        increment({ namespace, identifier, windowMs, time }) {
            if (time >= nextSweep) {
                for (const [id, bucket] of buckets) if (bucket.reset <= time) buckets.delete(id);
                nextSweep = time + Math.min(windowMs, 60_000);
            }
            const id = JSON.stringify([namespace, identifier, windowMs]);
            let bucket = buckets.get(id);
            if (!bucket || bucket.reset <= time) {
                if (!bucket && buckets.size >= 10_000) throw new Error("Rate limit store is full");
                bucket = { count: 0, reset: time + windowMs };
                buckets.set(id, bucket);
            }
            bucket.count++;
            return { ...bucket };
        },
    };
}
