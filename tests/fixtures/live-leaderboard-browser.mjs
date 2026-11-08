// Local visual fixture. No MongoDB, Redis, QStash, Cloudinary or real accounts.
import express from "express";
import { createLeaderboardRouter } from "../../backend/leaderboard/transport.js";

if (process.env.LEADERBOARD_BROWSER_FIXTURE !== "1") throw new Error("Set LEADERBOARD_BROWSER_FIXTURE=1 to run this isolated fixture.");
const app = express();
const names = ["BishopJump", "NightRook", "QuietKnight", "PawnStorm", "DiagonalMind", "CastleKeeper", "You", "RookAndRoll"];
const entries = Array.from({ length: 100 }, (_, index) => ({
    userId: String(index + 1).padStart(24, "0"), username: names[index] || `player_${index + 1}`,
    name: names[index] || `Player ${index + 1}`, rank: index + 1,
    elo: 1842 - index * 7, matches: 186 + index * 7, wins: 120 + index * 3,
}));
let state = "ranked";
const generatedAt = Date.now() - 120_000;
app.get("/__fixture/mobile", (_req, res) => res.type("html").send('<!doctype html><html><body style="margin:0;background:#080a0b"><iframe title="Mobile leaderboard" src="http://127.0.0.1:3008/leaderboard" style="width:360px;height:680px;border:0"></iframe></body></html>'));
app.get("/__fixture/:state", (req, res) => { state = req.params.state; res.json({ state }); });
app.get("/api/auth/me", (_req, res) => {
    if (state === "guest") return res.status(401).json({ error: "Please sign in." });
    res.json({ _id: ["outside", "qualifying"].includes(state) ? "ffffffffffffffffffffffff" : entries[6].userId,
        username: "You", profileImg: "", elo: state === "outside" ? 800 : entries[6].elo,
        matches: state === "qualifying" ? 2 : entries[6].matches, wins: state === "qualifying" ? 1 : entries[6].wins });
});
app.post("/api/matchmaking/presence", (_req, res) => res.json({ online: 1 }));
// Disable browser caching only in this fixture so state switches are immediate.
app.use("/api/leaderboard", (_req, res, next) => {
    const set = res.setHeader.bind(res);
    res.setHeader = (name, value) => set(name, name.toLowerCase() === "cache-control" ? "no-store" : value);
    next();
}, createLeaderboardRouter({ service: { read: async () => {
    if (state === "error") throw new Error("Fixture outage");
    return { generatedAt, entries: state === "empty" ? [] : state === "few" ? entries.slice(0, 2) : entries };
} } }));
app.listen(5004, "127.0.0.1", () => console.log("Isolated leaderboard fixture: http://127.0.0.1:5004"));
