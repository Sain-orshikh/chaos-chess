import mongoose from "mongoose";

const entry = new mongoose.Schema({
    userId: String, username: String, name: String, elo: Number,
    matches: Number, wins: Number, rank: Number,
    profileImg: { type: String, default: '' },
    equippedBadges: { type: [String], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
    _id: String,
    generatedAt: { type: Number, default: null },
    nextRefreshAt: { type: Number, default: 0 },
    nextAttemptAt: { type: Number, default: 0 },
    leaseUntil: { type: Number, default: 0 },
    leaseOwner: { type: String, default: "" },
    entries: { type: [entry], default: [] },
}, { versionKey: false });

// Expired snapshots are retained for stale reads; never TTL-delete this document.
export default mongoose.model("LeaderboardSnapshot", schema);
