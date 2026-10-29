import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import { clearTokenCookie } from "../utils/generateToken.js";

export const protectRoute = async (req, res, next) => {
    const token = req.cookies.jwt;
    if (typeof token !== "string" || token.length > 4096) return res.status(401).json({ error: "Please sign in." });
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
        if (typeof decoded !== "object" || typeof decoded.userId !== "string" || !/^[a-f0-9]{24}$/i.test(decoded.userId)) throw new Error("Invalid user");
    } catch {
        clearTokenCookie(res);
        return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    try {
        const user = await User.findById(decoded.userId).select("-password");
        if (!user) {
            clearTokenCookie(res);
            return res.status(401).json({ error: "Please sign in again." });
        }
        req.user = user;
        next();
    } catch {
        return res.status(503).json({ error: "Account service is unavailable. You can still play anonymously." });
    }
};
