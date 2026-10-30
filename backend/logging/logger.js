import "../config/env.js";
import pino from "pino";

export function redactMessage(value) {
    let message = String(value ?? "");
    for (const [name, secret] of Object.entries(process.env)) {
        if (secret && secret.length >= 4 && /SECRET|TOKEN|PASSWORD|API_KEY|MONGO.*URI|CLOUDINARY_URL/i.test(name)) {
            message = message.split(secret).join("[Redacted]");
        }
    }
    return message
        .replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[Redacted image]")
        .replace(/(mongodb(?:\+srv)?:\/\/)[^\s]+/gi, "$1[Redacted]")
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [Redacted]");
}

// Cloudinary rejects with plain objects, so serializing only Error.name loses its actual message.
export function serializeError(error) {
    const source = error?.error ?? error;
    return {
        type: typeof source?.name === "string" ? source.name : "Error",
        message: redactMessage(source?.message ?? "An operation failed").slice(0, 2000),
        ...(typeof source?.code === "string" || typeof source?.code === "number" ? { code: source.code } : {}),
        ...(typeof source?.http_code === "number" ? { httpCode: source.http_code } : {}),
        ...(typeof source?.stack === "string" ? { stack: redactMessage(source.stack).slice(0, 6000) } : {}),
    };
}

export function createLogger(destination) {
    return pino({
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
        base: { service: "chaos-chess-api", environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development" },
        timestamp: pino.stdTimeFunctions.isoTime,
        serializers: { err: serializeError },
        redact: {
            paths: ["password", "currentPassword", "newPassword", "token", "secret", "profileImg", "req.headers", "req.body", "res.headers", "user.password", "*.password", "*.token", "*.secret"],
            censor: "[Redacted]",
        },
    }, destination || pino.multistream([
        { level: "trace", stream: process.stdout },
        { level: "error", stream: process.stderr },
    ], { dedupe: true }));
}

export const logger = createLogger();
