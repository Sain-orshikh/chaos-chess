import "../config/env.js";
import { isIP } from "node:net";
import { createMemoryRateLimitStore, createMongoRateLimitStore } from "./rateLimitStore.js";

export function clientIp(req) {
    if (process.env.VERCEL) {
        // Vercel replaces this header at ingress. Never trust it on a directly exposed local server.
        const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"];
        if (typeof forwarded === "string" && isIP(forwarded.trim())) return forwarded.trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
}

export function rateLimit({ limit, windowMs, namespace = "api", key = clientIp, now = Date.now, store } = {}) {
    const shared = store || (process.env.VERCEL || process.env.NODE_ENV === "production" ? createMongoRateLimitStore() : createMemoryRateLimitStore());
    return async (req, res, next) => {
        try {
            const time = now();
            const bucket = await shared.increment({ namespace, identifier: String(key(req)), windowMs, time });
            const seconds = Math.max(1, Math.ceil((bucket.reset - time) / 1000));
            res.setHeader("RateLimit-Limit", limit);
            res.setHeader("RateLimit-Remaining", Math.max(0, limit - bucket.count));
            res.setHeader("RateLimit-Reset", seconds);
            if (bucket.count > limit) {
                res.setHeader("Retry-After", seconds);
                req.log?.warn({ event: "rate_limit_exceeded", policy: namespace }, "Request rate limited");
                return res.status(429).json({ error: "Too many requests. Please wait and try again." });
            }
            next();
        } catch (error) {
            req.log?.error({ err: error, event: "rate_limit_unavailable", policy: namespace }, "Rate limit check failed");
            res.setHeader("Retry-After", 5);
            return res.status(503).json({ error: "Service is temporarily unavailable. Please try again shortly." });
        }
    };
}
