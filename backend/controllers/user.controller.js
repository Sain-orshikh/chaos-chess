import { publicUser } from "./auth.controller.js";
import { logger } from "../logging/logger.js";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Game from "../models/game.model.js";
import { calculateRatings } from "../utils/elo.js";
import User from "../models/user.model.js";
import { fields, username, password, profileImage, ValidationError, validationResponse } from "../security/validation.js";
import { uploadProfileImage } from "../utils/uploadProfileImage.js";

export const getUserProfile = async (req, res) => {
    try {
        const name = username(req.params.username);
        const user = await User.findOne({ username: name }).select("-password");
        if (!user) return res.status(404).json({ error: "User not found." });
        return res.json(publicUser(user));
    } catch (error) {
        if (validationResponse(error, res)) return;
        return res.status(500).json({ error: "Could not load this profile." });
    }
};

export const updateUser = async (req, res) => {
    try {
        // Never pass request objects to Mongo queries or updates. Elo and stats are not writable here.
        fields(req.body, ["username", "currentPassword", "newPassword", "profileImg"]);
        const body = req.body;
        if (!Object.keys(body).length) throw new ValidationError("Choose a profile setting to update.");
        const name = body.username === undefined ? undefined : username(body.username);
        const changingPassword = body.currentPassword !== undefined || body.newPassword !== undefined;
        const current = changingPassword ? password(body.currentPassword) : undefined;
        const next = changingPassword ? password(body.newPassword) : undefined;
        const image = body.profileImg === undefined ? null : await profileImage(body.profileImg);
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: "User not found." });
        if (name && name !== user.username && await User.exists({ username: name })) {
            return res.status(400).json({ error: "Username is already taken." });
        }
        if (changingPassword) {
            if (!user.password || !await bcrypt.compare(current, user.password)) return res.status(400).json({ error: "Current password is incorrect." });
            user.password = await bcrypt.hash(next, 12);
        }
        if (image) user.profileImg = await uploadProfileImage(image, user._id);
        if (name) user.username = name;
        await user.save();
        return res.json(publicUser(user));
    } catch (error) {
        if (validationResponse(error, res)) return;
        if (error.code === 11000) return res.status(400).json({ error: "Username is already taken." });
        (req.log || logger).error({ err: error, event: "profile_update_failed" }, "Profile update failed");
        return res.status(500).json({ error: "Could not save your profile. Please try again." });
    }
};

export const finalizeGame = async (req, res) => {
    try {
        // Players and results come from the server-owned game, never the caller.
        fields(req.body, []);
        const gameId = req.params.gameId;
        if (typeof gameId !== "string" || !/^[a-f0-9]{24}$/i.test(gameId)) {
            throw new ValidationError("Invalid game ID.");
        }
        const outcome = await mongoose.connection.transaction(async (session) => {
            const game = await Game.findById(gameId).session(session);
            if (!game) return { status: 404, body: { error: "Game not found." } };
            const caller = String(req.user._id);
            if (String(game.playerA) !== caller && String(game.playerB) !== caller) {
                return { status: 403, body: { error: "You are not a player in this game." } };
            }
            if (!game.rated) return { status: 409, body: { error: "This game is unrated." } };
            if (game.status !== "finished" || !["a", "b", "draw"].includes(game.result)) {
                return { status: 409, body: { error: "The server has not confirmed a finished game." } };
            }
            const resultBody = () => ({ gameId: String(game._id), result: game.result, ratings: game.ratings });
            if (game.finalizedAt) return { status: 200, body: resultBody() };
            if (String(game.playerA) === String(game.playerB)) {
                return { status: 409, body: { error: "Players must be different." } };
            }
            // MongoDB transactions do not support parallel operations on a session.
            const userA = await User.findById(game.playerA).session(session);
            const userB = await User.findById(game.playerB).session(session);
            if (!userA || !userB) return { status: 404, body: { error: "User not found." } };
            const beforeA = userA.elo;
            const beforeB = userB.elo;
            const after = calculateRatings(beforeA, beforeB, game.result);
            userA.elo = after.a;
            userB.elo = after.b;
            userA.matches += 1;
            userB.matches += 1;
            userA.wins += game.result === "a" ? 1 : 0;
            userB.wins += game.result === "b" ? 1 : 0;
            game.ratings = {
                a: { userId: userA._id, before: beforeA, after: after.a, change: after.a - beforeA },
                b: { userId: userB._id, before: beforeB, after: after.b, change: after.b - beforeB },
            };
            game.finalizedAt = new Date();
            // Concurrent finalizations conflict on these documents and retry the transaction.
            // A retry reads finalizedAt and returns the stored changes without rating twice.
            await userA.save({ session });
            await userB.save({ session });
            await game.save({ session });
            return { status: 200, body: resultBody() };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (validationResponse(error, res)) return;
        (req.log || logger).error({ err: error, event: "game_finalization_failed" }, "Game finalization failed");
        return res.status(500).json({ error: "Could not finalize game. Please try again." });
    }
};
