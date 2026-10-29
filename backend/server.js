import path from "path";
import express from "express";
import dotenv from "dotenv";
import {v2 as cloudinary} from "cloudinary";
import cors from "cors";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/user.route.js"
import { rateLimit } from "./security/rateLimit.js";
import connectMongoDB from "./db/connectMongoDB.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
}); 

export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
const PORT = process.env.PORT || 5000;

// CORS configuration - allow frontend to access backend
const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.includes(origin);
        if (!isAllowed) {
            return callback(new Error('CORS policy violation'), false);
        }
        return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use("/api", rateLimit({ limit: 120, windowMs: 60_000 }));
app.use(express.json({limit: "3mb", strict: true})); // to parse req.body

app.use(cookieParser());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Running' });
});

// Express identifies error middleware by its four parameters.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error, _req, res, _next) => {
    if (error.type === "entity.too.large") return res.status(413).json({ error: "The uploaded file is too large." });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: "Invalid JSON request." });
    if (error.message === "CORS policy violation") return res.status(403).json({ error: "Origin is not allowed." });
    return res.status(500).json({ error: "Request failed. Please try again." });
});

if (process.env.NODE_ENV !== "test") {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        connectMongoDB();
    });
}
