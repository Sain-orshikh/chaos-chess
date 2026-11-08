import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import mongoose from "mongoose";
import { calculateRatings } from "../backend/utils/elo.js";
import { finalizeGame } from "../backend/controllers/user.controller.js";
import Game from "../backend/models/game.model.js";
import User from "../backend/models/user.model.js";
import { createApp } from "../backend/server.js";
import { createMemoryRateLimitStore } from "../backend/security/rateLimitStore.js";

const gameId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const playerA = "bbbbbbbbbbbbbbbbbbbbbbbb";
const playerB = "cccccccccccccccccccccccc";
function response() {
    return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(body = {}, caller = playerA) {
    return { params: { gameId }, body, user: { _id: caller }, log: { error() {} } };
}

test("Elo handles wins, losses, draws, rating differences, and the K threshold", () => {
    assert.deepEqual(calculateRatings(0, 0, "a"), { a: 20, b: -20 });
    assert.deepEqual(calculateRatings(1200, 1200, "a"), { a: 1215, b: 1185 });
    assert.deepEqual(calculateRatings(1200, 1200, "b"), { a: 1185, b: 1215 });
    assert.deepEqual(calculateRatings(1200, 1200, "draw"), { a: 1200, b: 1200 });
    assert.deepEqual(calculateRatings(800, 1200, "a"), { a: 836, b: 1173 });
    assert.deepEqual(calculateRatings(800, 1200, "draw"), { a: 816, b: 1188 });
    assert.deepEqual(calculateRatings(1000, 1000, "a"), { a: 1015, b: 985 });
    assert.throws(() => calculateRatings(1000, 1000, "bad"), TypeError);
    assert.throws(() => calculateRatings(NaN, 1000, "a"), TypeError);
});

test("finalization validates requests and applies both players' updates in one session", async (t) => {
    const originals = { transaction: mongoose.connection.transaction, gameFind: Game.findById, userFind: User.findById };
    const session = {};
    let game, users, writes, transactions;
    function reset(result = "a") {
        writes = []; transactions = 0;
        game = { _id: gameId, playerA, playerB, rated: true, status: "finished", result, finalizedAt: null,
            async save(options) { assert.equal(options.session, session); writes.push("game"); } };
        users = new Map([playerA, playerB].map(id => [id, { _id: id, elo: 1200, matches: 0, wins: 0,
            async save(options) { assert.equal(options.session, session); writes.push(id); } }]));
    }
    mongoose.connection.transaction = async (fn, options) => {
        transactions++;
        assert.equal(options.writeConcern.w, "majority");
        assert.equal(options.readConcern.level, "snapshot");
        return fn(session);
    };
    Game.findById = id => ({ session(value) { assert.equal(id, gameId); assert.equal(value, session); return game; } });
    User.findById = id => ({ session(value) { assert.equal(value, session); return users.get(String(id)); } });
    try {
        await t.test("rejects client-supplied players, results, and invalid game IDs before a transaction", async () => {
            reset();
            for (const body of [{ usernameA: "Alice" }, { won: "a" }, { result: "draw" }, null, []]) {
                const res = response(); await finalizeGame(request(body), res); assert.equal(res.statusCode, 400);
            }
            const req = request(); req.params.gameId = "bad";
            const res = response(); await finalizeGame(req, res); assert.equal(res.statusCode, 400);
            assert.equal(transactions, 0);
        });
        await t.test("win updates ratings, match counts, and winner; repeat call writes nothing", async () => {
            reset();
            const res = response(); await finalizeGame(request(), res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.ratings.a.after, 1215);
            assert.equal(res.body.ratings.b.after, 1185);
            assert.equal(users.get(playerA).matches, 1);
            assert.equal(users.get(playerB).matches, 1);
            assert.equal(users.get(playerA).wins, 1);
            assert.equal(users.get(playerB).wins, 0);
            assert.deepEqual(writes, [playerA, playerB, "game"]);
            const again = response(); await finalizeGame(request({}, playerB), again);
            assert.deepEqual(again.body, res.body);
            assert.equal(writes.length, 3);
            assert.equal(users.get(playerA).matches, 1);
        });
        for (const result of ["b", "draw"]) {
            await t.test(`records ${result} correctly`, async () => {
                reset(result);
                const res = response(); await finalizeGame(request(), res);
                assert.equal(res.statusCode, 200);
                assert.equal(users.get(playerA).wins, 0);
                assert.equal(users.get(playerB).wins, result === "b" ? 1 : 0);
                assert.equal(users.get(playerA).elo, result === "draw" ? 1200 : 1185);
                assert.equal(users.get(playerB).matches, 1);
            });
        }
        await t.test("rejects strangers, unfinished, unrated, corrupt, self-play, and missing games", async () => {
            for (const [mutate, caller, status] of [
                [() => {}, "dddddddddddddddddddddddd", 403],
                [() => { game.status = "playing"; }, playerA, 409],
                [() => { game.rated = false; }, playerA, 409],
                [() => { game.result = null; }, playerA, 409],
                [() => { game.playerB = playerA; }, playerA, 409],
                [() => { game = null; }, playerA, 404],
                [() => { users.delete(playerB); }, playerA, 404],
            ]) {
                reset(); mutate();
                const res = response(); await finalizeGame(request({}, caller), res);
                assert.equal(res.statusCode, status);
                assert.deepEqual(writes, []);
            }
        });
        await t.test("save failure is returned as an error, not a hanging request", async () => {
            reset();
            users.get(playerB).save = async () => { throw new Error("database unavailable"); };
            const res = response(); await finalizeGame(request(), res);
            assert.equal(res.statusCode, 500);
            assert.equal(writes.includes("game"), false);
        });
    } finally {
        mongoose.connection.transaction = originals.transaction;
        Game.findById = originals.gameFind;
        User.findById = originals.userFind;
    }
});

test("finalization route is mounted and requires authentication", async () => {
    const app = createApp({ connect: async () => {}, limiterStore: createMemoryRateLimitStore() });
    const server = app.listen(0, "127.0.0.1");
    try {
        await once(server, "listening");
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/games/${gameId}/finalize`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        assert.equal(res.status, 401);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
