import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            unique: true,
            required: true,
        },
        password: {
            type: String,
            required: function () { return !this.googleId; },
            minLength: 6,
        },
        googleId: { type: String, unique: true, sparse: true },
        displayName: { type: String, maxLength: 100 },
        profileImg: {
            type: String,
            default: "",
        },
        elo: {
            type: Number,
            default: 500,
        },
        matches: {
            type: Number,
            default: 0,
        },
        wins: {
            type: Number,
            default: 0,
        },
        badges: { type: Map, of: Date, default: () => ({}) },
        statsUpdatedAt: { type: Date, default: null },
        equippedBadges: { type: [String], default: [] },
        badgeProgress: {
            type: new mongoose.Schema({
                classicWins: { type: Number, default: 0 },
                chaosWins: { type: Number, default: 0 },
                winStreak: { type: Number, default: 0 },
            }, { _id: false }),
            default: () => ({}),
        },
    },
    { timestamps: true }
);

userSchema.index({ elo: -1, _id: 1 }, {
    name: "leaderboard_eligible_elo",
    partialFilterExpression: { matches: { $gte: 5 } },
});

const User = mongoose.model("User", userSchema);

export default User;
