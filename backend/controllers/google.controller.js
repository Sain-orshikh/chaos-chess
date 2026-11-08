import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import User from "../models/user.model.js";
import { generateTokenAndSetCookie } from "../utils/generateToken.js";

const cookieName = "google_oauth";
const random = () => randomBytes(32).toString("base64url");
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google" });

export function googleConfig() {
    const origin = process.env.NODE_ENV === "production" || process.env.VERCEL
        ? "https://havoc-chess.vercel.app" : "http://localhost:3000";
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.JWT_SECRET) {
        throw new Error("Google sign-in is not configured");
    }
    return { origin, client: new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${origin}/api/auth/google/callback`) };
}

export function startGoogle(_req, res) {
    try {
        const { client } = googleConfig();
        const state = random(), nonce = random(), verifier = random();
        const flow = jwt.sign({ state, nonce, verifier }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "10m", audience: "google-oauth" });
        res.cookie(cookieName, flow, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
        return res.redirect(client.generateAuthUrl({
            scope: ["openid", "profile"], state, nonce,
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256", prompt: "select_account",
        }));
    } catch {
        return res.status(503).json({ error: "Google sign-in is unavailable. Please try again later." });
    }
}

// Client injection keeps protocol failure tests independent of Google's live service.
export function googleCallbackHandler(configure = googleConfig) {
    return async (req, res) => {
        res.setHeader("Referrer-Policy", "no-referrer");
        res.clearCookie(cookieName, cookieOptions());
        let config;
        try { config = configure(); }
        catch { return res.status(503).json({ error: "Google sign-in is unavailable. Please try again later." }); }
        try {
            const flow = jwt.verify(req.cookies?.[cookieName], process.env.JWT_SECRET, { algorithms: ["HS256"], audience: "google-oauth" });
            if (typeof flow !== "object" || typeof flow.state !== "string" || typeof flow.nonce !== "string" || typeof flow.verifier !== "string" || typeof req.query.state !== "string" || req.query.state !== flow.state) throw new Error("Invalid OAuth state");
            if (req.query.error) return res.redirect(`${config.origin}/?auth_error=google_cancelled`);
            if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) throw new Error("Invalid OAuth code");
            const { tokens } = await config.client.getToken({ code: req.query.code, codeVerifier: flow.verifier });
            const ticket = await config.client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
            const identity = ticket.getPayload();
            if (!identity || typeof identity.sub !== "string" || !identity.sub || identity.nonce !== flow.nonce) throw new Error("Invalid Google identity");
            const displayName = typeof identity.name === "string" && identity.name.trim() ? identity.name.trim().slice(0, 100) : "Chess player";
            // Identity is keyed only by Google's verified subject, never by name or email.
            let user = await User.findOne({ googleId: identity.sub });
            if (!user) {
                try {
                    user = await User.create({ googleId: identity.sub, displayName, username: `g_${randomBytes(10).toString("hex")}` });
                } catch (error) {
                    if (error.code !== 11000) throw error;
                    user = await User.findOne({ googleId: identity.sub });
                    if (!user) throw error;
                }
            } else if (user.displayName !== displayName) {
                user.displayName = displayName;
                await user.save();
            }
            generateTokenAndSetCookie(user._id, res);
            return res.redirect(`${config.origin}/`);
        } catch {
            // Do not log tokens, authorization codes, or provider error payloads.
            return res.redirect(`${config.origin}/?auth_error=google_failed`);
        }
    };
}
export const googleCallback = googleCallbackHandler();
