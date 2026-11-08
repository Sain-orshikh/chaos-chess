import express from "express";
import { createLeaderboardService, MAX_AGE_MS, REFRESH_MS } from "./service.js";
import { logger } from "../logging/logger.js";

export function createLeaderboardRouter({ service = createLeaderboardService({ log: logger }), now = Date.now } = {}) {
    const router = express.Router();
    router.use(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (req.path !== "/" || req.originalUrl.split("?")[0] !== "/api/leaderboard") return res.status(404).json({ error: "Leaderboard route not found." });
        if (!["GET", "HEAD"].includes(req.method)) {
            res.setHeader("Allow", "GET, HEAD");
            return res.status(405).json({ error: "Use GET to read the leaderboard." });
        }
        if (req.originalUrl.includes("?")) return res.status(400).json({ error: "Leaderboard query parameters are not supported." });
        try {
            const snapshot = await service.read();
            const age = Math.max(0, now() - snapshot.generatedAt);
            const ttl = age >= REFRESH_MS ? 10 : 60;
            const fallback = Math.max(0, Math.floor((MAX_AGE_MS - age) / 1000) - ttl);
            res.setHeader("Cache-Control", "public, max-age=30");
            res.setHeader("Vercel-CDN-Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=30, stale-if-error=${fallback}`);
            return res.json(snapshot);
        } catch (error) {
            req.log?.warn({ err: error, event: "leaderboard_unavailable" }, "Leaderboard unavailable");
            res.setHeader("Retry-After", "60");
            return res.status(503).json({ error: "Standings are temporarily unavailable. Please try again shortly." });
        }
    });
    return router;
}
