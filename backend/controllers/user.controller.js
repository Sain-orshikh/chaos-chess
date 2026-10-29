import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import { fields, username, password, profileImage, ValidationError, validationResponse } from "../security/validation.js";
import { uploadProfileImage } from "../utils/uploadProfileImage.js";

export const getUserProfile = async (req, res) => {
    try {
        const name = username(req.params.username);
        const user = await User.findOne({ username: name }).select("-password");
        if (!user) return res.status(404).json({ error: "User not found." });
        return res.json(user);
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
            if (!await bcrypt.compare(current, user.password)) return res.status(400).json({ error: "Current password is incorrect." });
            user.password = await bcrypt.hash(next, 12);
        }
        if (image) user.profileImg = await uploadProfileImage(image, user._id);
        if (name) user.username = name;
        await user.save();
        return res.json({ _id: user._id, username: user.username, profileImg: user.profileImg, elo: user.elo, matches: user.matches, wins: user.wins });
    } catch (error) {
        if (validationResponse(error, res)) return;
        if (error.code === 11000) return res.status(400).json({ error: "Username is already taken." });
        console.error("Profile update failed:", error.name);
        return res.status(500).json({ error: "Could not save your profile. Please try again." });
    }
};
