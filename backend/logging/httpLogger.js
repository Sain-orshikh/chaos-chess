import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { logger } from "./logger.js";

export function httpLogger(instance = logger) {
    return pinoHttp({
        logger: instance,
        quietReqLogger: true,
        genReqId(_req, res) {
            const id = randomUUID();
            res.setHeader("X-Request-Id", id);
            return id;
        },
        serializers: {
            req: req => ({ method: req.method, path: (req.url || "").split("?")[0] }),
            res: res => ({ statusCode: res.statusCode }),
        },
        customLogLevel(_req, res, error) { return error || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"; },
        customSuccessMessage: () => "Request completed",
        customErrorMessage: () => "Request failed",
    });
}
