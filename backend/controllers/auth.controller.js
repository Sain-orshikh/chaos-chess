import { logger } from "../logging/logger.js";
import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import { generateTokenAndSetCookie, clearTokenCookie } from "../utils/generateToken.js";
import { fields, username, password, profileImage, validationResponse } from "../security/validation.js";
import { uploadProfileImage } from "../utils/uploadProfileImage.js";

function publicUser(user) {
    return { _id: user._id, username: user.username, profileImg: user.profileImg, elo: user.elo, matches: user.matches, wins: user.wins };
}

export const signup = async (req, res) => {
    try {
        fields(req.body, ["username", "password", "profileImg"]);
        const name = username(req.body.username);
        const secret = password(req.body.password);
        const image = req.body.profileImg === undefined ? null : await profileImage(req.body.profileImg);
        if (await User.findOne({ username: name })) return res.status(400).json({ error: "Username is already taken." });
        const user = new User({ username: name, password: await bcrypt.hash(secret, 12) });
        if (image) user.profileImg = await uploadProfileImage(image, user._id);
        await user.save();
        generateTokenAndSetCookie(user._id, res);
        return res.status(201).json(publicUser(user));
    } catch (error) {
        if (validationResponse(error, res)) return;
        if (error.code === 11000) return res.status(400).json({ error: "Username is already taken." });
        (req.log || logger).error({ err: error, event: "signup_failed" }, "Signup failed");
        return res.status(500).json({ error: "Could not create your account. Please try again." });
    }
};

export const login = async (req, res) => {
    try {
        fields(req.body, ["username", "password"]);
        const name = username(req.body.username);
        const secret = password(req.body.password);
        const user = await User.findOne({ username: name });
        // A valid bcrypt hash keeps unknown-user requests on the same expensive comparison path.
        const fallbackHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxQcWvFhERH0Cl/rcfZmHWAWQOm";
        const matches = await bcrypt.compare(secret, user?.password || fallbackHash);
        if (!user || !matches) return res.status(400).json({ error: "Invalid username or password." });
        generateTokenAndSetCookie(user._id, res);
        return res.json(publicUser(user));
    } catch (error) {
        if (validationResponse(error, res)) return;
        (req.log || logger).error({ err: error, event: "login_failed" }, "Login failed");
        return res.status(500).json({ error: "Could not sign in. Please try again." });
    }
};

export const logout = (_req, res) => {
    clearTokenCookie(res);
    return res.json({ message: "Signed out." });
};

export const getMe = (req, res) => res.json(publicUser(req.user));
