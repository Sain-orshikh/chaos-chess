import "./config/env.js";
import { pathToFileURL } from "node:url";
import express from "express";
import { v2 as cloudinary } from "cloudinary";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/user.route.js";
import { rateLimit } from "./security/rateLimit.js";
import connectMongoDB from "./db/connectMongoDB.js";
import { logger } from "./logging/logger.js";
import { httpLogger } from "./logging/httpLogger.js";
import { allowedOrigin } from "./config/cors.js";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

export function createApp({ connect = connectMongoDB, log = logger, limiterStore } = {}) {
    const app = express();
    app.disable("x-powered-by");
    if (!process.env.VERCEL && process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
    app.use(httpLogger(log));

    app.use(cors((req, callback) => {
        if (!allowedOrigin(req.headers.origin, req.headers.host)) return callback(new Error("CORS policy violation"));
        callback(null, { origin: true, credentials: true, methods: ["GET", "POST", "OPTIONS"] });
    }));
    app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
    app.use("/api", async (req, res, next) => {
        try { await connect(); next(); }
        catch (error) {
            req.log.error({ err: error, event: "database_unavailable" }, "Database connection failed");
            res.status(503).json({ error: "Account service is unavailable. You can still play anonymously." });
        }
    });
    app.use("/api", rateLimit({ limit: 120, windowMs: 60_000, namespace: "api", store: limiterStore }));
    app.use(express.json({ limit: "3mb", strict: true }));
    app.use(cookieParser());
    app.use("/api/auth", authRoutes);
    app.use("/api/user", userRoutes);
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));

    // Express identifies error middleware by its four parameters.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((error, req, res, _next) => {
        if (error.type === "entity.too.large") return res.status(413).json({ error: "The uploaded file is too large." });
        if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: "Invalid JSON request." });
        if (error.message === "CORS policy violation") return res.status(403).json({ error: "Origin is not allowed." });
        req.log.error({ err: error, event: "unhandled_request_error" }, "Request failed");
        return res.status(500).json({ error: "Request failed. Please try again." });
    });
    return app;
}

export const app = createApp();
export default app;

// Vercel imports the app; only a directly invoked local server binds a port.
if (!process.env.VERCEL && process.env.NODE_ENV !== "test" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = process.env.PORT || 5000;
    connectMongoDB().then(() => {
        app.listen(port, () => logger.info({ port, event: "server_started" }, "API server started"));
    }).catch(error => {
        logger.fatal({ err: error, event: "startup_failed" }, "API startup failed");
        process.exitCode = 1;
    });
}
