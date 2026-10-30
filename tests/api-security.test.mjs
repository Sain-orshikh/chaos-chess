import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fields, username, password, profileImage, ValidationError } from "../backend/security/validation.js";
import { rateLimit } from "../backend/security/rateLimit.js";
import bcrypt from "bcryptjs";
import { signup, login, logout } from "../backend/controllers/auth.controller.js";
import { updateUser, getUserProfile } from "../backend/controllers/user.controller.js";
import { protectRoute } from "../backend/middleware/protectRoute.js";
import User from "../backend/models/user.model.js";
import jwt from "jsonwebtoken";

function response() {
    return { statusCode: 200, headers: {}, body: null, cookies: [], status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, cookie(...value) { this.cookies.push(value); }, clearCookie(...value) { this.cookies.push(value); } };
}

for (const value of [{ $ne: null }, ["alice"], null, 123, "a'; DROP TABLE users;--", "alice.$where", "a", "a".repeat(25)]) {
    test(`username rejects unsafe or invalid value ${JSON.stringify(value)}`, () => assert.throws(() => username(value), ValidationError));
}
test("usernames are plain scalar strings; passwords remain literal strings", () => {
    assert.equal(username("Player_123"), "Player_123");
    assert.equal(password("'; DROP TABLE users;--"), "'; DROP TABLE users;--");
    for (const value of [{ $gt: "" }, ["secret"], null, "short", "a\0password", "a".repeat(73), "🙂".repeat(19)]) assert.throws(() => password(value), ValidationError);
});
test("unexpected keys, arrays, nested operators, and stat writes are rejected", () => {
    for (const body of [null, [], { $where: "true" }, { elo: 1000 }, JSON.parse('{"__proto__":{"admin":true}}')]) assert.throws(() => fields(body, ["username"]), ValidationError);
});

test("rate limits reject excess requests and reset after the window", async () => {
    let time = 1000, passed = 0;
    const limiter = rateLimit({ limit: 2, windowMs: 60_000, now: () => time });
    const request = { ip: "client-a", headers: { "x-forwarded-for": "spoofed" } };
    await limiter(request, response(), () => passed++);
    await limiter(request, response(), () => passed++);
    const denied = response(); await limiter(request, denied, () => passed++);
    assert.equal(passed, 2); assert.equal(denied.statusCode, 429); assert.equal(denied.headers["Retry-After"], 60);
    await limiter({ ip: "client-b" }, response(), () => passed++); assert.equal(passed, 3);
    time += 60_000; await limiter(request, response(), () => passed++); assert.equal(passed, 4);
});
test("profile update limits can follow the account across IPs", async () => {
    const limiter = rateLimit({ limit: 1, windowMs: 1000, key: req => req.user._id });
    await limiter({ ip: "one", user: { _id: "same" } }, response(), () => {});
    const res = response(); await limiter({ ip: "two", user: { _id: "same" } }, res, () => assert.fail("must be limited")); assert.equal(res.statusCode, 429);
});

for (const format of ["png", "jpeg", "webp", "gif"]) {
    test(`valid ${format} uploads are decoded and re-encoded to WebP`, async () => {
        const buffer = await sharp({ create: { width: 3, height: 3, channels: 3, background: "red" } }).toFormat(format).toBuffer();
        const type = `image/${format}`;
        const output = await profileImage({ name: `avatar.${format === "jpeg" ? "jpg" : format}`, type, data: `data:${type};base64,${buffer.toString("base64")}` });
        assert.equal((await sharp(output).metadata()).format, "webp");
    });
}
test("image uploads reject SVGs, URLs, wrong MIME, wrong extension, corrupt data, and oversize inputs", async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    const data = `data:image/png;base64,${png.toString("base64")}`;
    const invalid = [
        "https://example.com/avatar.png", { $ne: null },
        { name: "avatar.svg", type: "image/svg+xml", data: "data:image/svg+xml;base64,PHN2Zy8+" },
        { name: "avatar.php", type: "image/png", data },
        { name: "avatar.png", type: "text/html", data },
        { name: "avatar.jpg", type: "image/jpeg", data: `data:image/jpeg;base64,${png.toString("base64")}` },
        { name: "avatar.png", type: "image/png", data: `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"/>').toString("base64")}` },
        { name: "avatar.png", type: "image/png", data: "data:image/png;base64,@@@@" },
        { name: "avatar.png", type: "image/png", data: `data:image/png;base64,${"A".repeat(2_800_000)}` },
    ];
    for (const value of invalid) await assert.rejects(() => profileImage(value), ValidationError);
});
test("image pixel limits reject decompression bombs", async () => {
    const buffer = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: "red" } }).png().toBuffer();
    await assert.rejects(() => profileImage({ name: "large.png", type: "image/png", data: `data:image/png;base64,${buffer.toString("base64")}` }), ValidationError);
});

test("account controllers reject injection before querying the database", async () => {
    const original = User.findOne;
    User.findOne = () => assert.fail("Unsafe input reached the database");
    try {
        for (const handler of [login, signup]) {
            for (const body of [{ username: { $ne: null }, password: "secret123" }, { username: "Player_123", password: { $ne: null } }, { username: "Player_123", password: "secret123", elo: 9999 }]) {
                const res = response(); await handler({ body }, res); assert.equal(res.statusCode, 400);
            }
        }
        const res = response(); await getUserProfile({ params: { username: { $ne: "" } } }, res); assert.equal(res.statusCode, 400);
    } finally { User.findOne = original; }
});
test("profile updates reject stat changes, operator passwords, and remote image URLs", async () => {
    for (const body of [{ elo: 9999 }, { matches: 1 }, { username: { $ne: null } }, { currentPassword: "secret123", newPassword: { $gt: "" } }, { profileImg: "https://example.com/a.png" }]) {
        const res = response(); await updateUser({ body, user: { _id: "123" } }, res); assert.equal(res.statusCode, 400);
    }
});
test("authenticated updates change only requested profile fields and preserve Elo", async () => {
    const original = User.findById;
    const user = { _id: "test-user", username: "Player_123", profileImg: "", elo: 987, matches: 42, wins: 19, save: async () => {} };
    User.findById = async () => user;
    try {
        const res = response(); await updateUser({ user: { _id: user._id }, body: { username: user.username } }, res);
        assert.equal(res.statusCode, 200); assert.equal(res.body.elo, 987); assert.equal(user.elo, 987); assert.equal(user.matches, 42); assert.equal(user.wins, 19); assert.equal(Object.hasOwn(res.body, "password"), false);
    } finally { User.findById = original; }
});
test("missing, expired, and forged tokens return 401", async () => {
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = "unit-test-secret-only";
    try {
        const expired = jwt.sign({ userId: "a".repeat(24) }, process.env.JWT_SECRET, { expiresIn: -1 });
        for (const value of [undefined, "forged-token", expired, jwt.sign({ userId: { $ne: "" } }, process.env.JWT_SECRET)]) {
            const res = response(); await protectRoute({ cookies: { jwt: value } }, res, () => assert.fail("must not authenticate")); assert.equal(res.statusCode, 401);
        }
    } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});


test("successful sign-in returns saved stats and an HTTP-only session; sign-out clears it", async () => {
    const original = User.findOne;
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-secret-only";
    const user = { _id: "a".repeat(24), username: "Player_123", password: await bcrypt.hash("test-password", 4), profileImg: "", elo: 987, matches: 42, wins: 19 };
    User.findOne = async query => { assert.deepEqual(query, { username: "Player_123" }); return user; };
    try {
        const res = response(); await login({ body: { username: "Player_123", password: "test-password" } }, res);
        assert.equal(res.statusCode, 200); assert.equal(res.body.matches, 42); assert.equal(res.body.wins, 19); assert.equal(res.body.elo, 987);
        assert.equal(Object.hasOwn(res.body, "password"), false);
        const [name, token, options] = res.cookies[0];
        assert.equal(name, "jwt"); assert.equal(options.httpOnly, true); assert.equal(options.sameSite, "strict"); assert.equal(options.path, "/");
        assert.equal(jwt.verify(token, process.env.JWT_SECRET).userId, user._id);
        const out = response(); logout({}, out); assert.equal(out.cookies[0][0], "jwt"); assert.equal(out.cookies[0][1].path, "/");
    } finally { User.findOne = original; if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});

test("password updates verify the old password, hash the new one, and preserve game stats", async () => {
    const original = User.findById;
    const user = { _id: "a".repeat(24), username: "Player_123", password: await bcrypt.hash("old-password", 4), profileImg: "", elo: 987, matches: 42, wins: 19, save: async () => {} };
    User.findById = async () => user;
    try {
        const denied = response(); await updateUser({ user, body: { currentPassword: "wrong-password", newPassword: "new-password" } }, denied); assert.equal(denied.statusCode, 400);
        const res = response(); await updateUser({ user, body: { currentPassword: "old-password", newPassword: "new-password" } }, res);
        assert.equal(res.statusCode, 200); assert.equal(await bcrypt.compare("new-password", user.password), true);
        assert.equal(user.elo, 987); assert.equal(user.matches, 42); assert.equal(user.wins, 19); assert.equal(Object.hasOwn(res.body, "password"), false);
    } finally { User.findById = original; }
});
