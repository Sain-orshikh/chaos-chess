import "../config/env.js";
import mongoose from "mongoose";

export function createMongoConnector(client, getUri = () => process.env.MONGODB_URI || process.env.MONGO_URI) {
    let pending;
    return async function connect() {
        if (client.connection.readyState === 1) return client;
        if (!pending) {
            const uri = getUri();
            if (!uri) throw new Error("MONGODB_URI is not configured");
            pending = client.connect(uri, {
                maxPoolSize: 10,
                minPoolSize: 0,
                maxIdleTimeMS: 30_000,
                serverSelectionTimeoutMS: 8000,
                appName: "chaos-chess",
            });
        }
        const attempt = pending;
        try {
            return await attempt;
        } finally {
            if (pending === attempt) pending = undefined;
        }
    };
}

// Module state survives warm invocations; concurrent requests share the connection promise and pool.
const connectMongoDB = createMongoConnector(mongoose);
export default connectMongoDB;
