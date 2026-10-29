// Per-process fixed windows. Deploy a shared limiter before running multiple API instances.
export function rateLimit({ limit, windowMs, key = (req) => req.ip, now = Date.now }) {
    const buckets = new Map();
    let nextSweep = 0;
    return (req, res, next) => {
        const time = now();
        if (time >= nextSweep) {
            for (const [id, bucket] of buckets) if (bucket.reset <= time) buckets.delete(id);
            nextSweep = time + Math.min(windowMs, 60_000);
        }
        const id = key(req);
        let bucket = buckets.get(id);
        if (!bucket || bucket.reset <= time) {
            if (!bucket && buckets.size >= 10_000) {
                return res.status(503).json({ error: "Too many requests. Please try again shortly." });
            }
            bucket = { count: 0, reset: time + windowMs };
            buckets.set(id, bucket);
        }
        bucket.count += 1;
        res.setHeader("RateLimit-Limit", limit);
        res.setHeader("RateLimit-Remaining", Math.max(0, limit - bucket.count));
        res.setHeader("RateLimit-Reset", Math.ceil((bucket.reset - time) / 1000));
        if (bucket.count > limit) {
            res.setHeader("Retry-After", Math.ceil((bucket.reset - time) / 1000));
            return res.status(429).json({ error: "Too many requests. Please wait and try again." });
        }
        next();
    };
}
