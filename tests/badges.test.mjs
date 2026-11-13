import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import User from '../backend/models/user.model.js';
import { BADGE_IDS, badgeMap, grantMilestones, recordBadgeResult, leaderboardAwards, equippedBadges } from '../backend/badges/rules.js';
import { reportRookeWin, reportKestrelWin, reportMerlinWin, equipBadges, syncBadges } from '../backend/badges/controller.js';
import { publicUser } from '../backend/controllers/auth.controller.js';
import { createMongoLeaderboardStore, publicEntries } from '../backend/leaderboard/service.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const { build } = createRequire(new URL('../backend/package.json', import.meta.url))('esbuild');
const now = new Date('2026-11-09T00:00:00Z');
const player = (extras = {}) => new User({ _id: A, username: 'Alice', password: 'password', ...extras });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('catalog and server agree on exactly 16 IDs; secret description stays absent', async () => {
    const catalog = JSON.parse(await readFile(new URL('../public/badges/manifest.json', import.meta.url)));
    assert.deepEqual(catalog.badges.map(badge => badge.id), [...BADGE_IDS]);
    assert.equal(catalog.badges.find(badge => badge.secret).description, null);
    assert.equal(player().elo, 500);
    assert.deepEqual(grantMilestones(player(), now), []);
});

test('600/1000 Elo and 1/10/100 win milestones are permanent and preserve original dates', () => {
    const user = player({ elo: 599 });
    assert.deepEqual(grantMilestones(user, now), []);
    user.elo = 600; user.wins = 1;
    assert.deepEqual(grantMilestones(user, now), ['first-blood', 'on-the-rise']);
    user.elo = 1000; user.wins = 10;
    assert.deepEqual(grantMilestones(user, now), ['four-figures', 'getting-dangerous']);
    user.wins = 100;
    assert.deepEqual(grantMilestones(user, now), ['centurion']);
    user.elo = 200; user.wins = 0;
    assert.deepEqual(grantMilestones(user, new Date()), []);
    assert.equal(badgeMap(user)['on-the-rise'].getTime(), now.getTime());
    assert.equal(Object.keys(badgeMap(user)).length, 5);
});

test('mode wins and win streaks advance only on wins, and a draw/loss breaks a streak', () => {
    const user = player();
    recordBadgeResult(user, true, 'normal', now);
    recordBadgeResult(user, true, 'chaos', now);
    assert.equal(user.badgeProgress.winStreak, 2);
    recordBadgeResult(user, false, 'chaos', now);
    assert.equal(user.badgeProgress.winStreak, 0);
    assert.equal(user.badgeProgress.chaosWins, 1);
    for (let i = 0; i < 9; i++) recordBadgeResult(user, true, 'normal', now);
    assert.equal(user.badgeProgress.classicWins, 10);
    assert.ok(badgeMap(user)['by-the-book']);
    assert.ok(badgeMap(user)['hat-trick']);
    for (let i = 0; i < 9; i++) recordBadgeResult(user, true, 'chaos', now);
    assert.ok(badgeMap(user)['chaos-theory']);
    assert.equal(badgeMap(user)['three-musketiers'], undefined);
    user.badges.set('rooke-awakening', now);
    assert.deepEqual(grantMilestones(user, now), ['three-musketiers']);
    recordBadgeResult(user, false, 'normal', now);
    assert.equal(user.badgeProgress.winStreak, 0);
    assert.ok(badgeMap(user)['hat-trick']);
});

test('Rooke-first secret unlocks after both human modes; no generic secret hints are exposed', () => {
    const user = player({ badges: { 'rooke-awakening': now } });
    recordBadgeResult(user, true, 'chaos', now);
    assert.equal(badgeMap(user)['three-musketiers'], undefined);
    recordBadgeResult(user, true, 'normal', now);
    assert.ok(badgeMap(user)['three-musketiers']);
    const projected = publicUser(user);
    assert.equal(projected.password, undefined);
    assert.equal(projected.googleId, undefined);
    assert.equal(projected.badgeRules, undefined);
    assert.equal(projected.badgeProgress.rookeBeaten, undefined);
    assert.equal(projected.badges['rooke-awakening'].getTime(), now.getTime());
});

test('badge commands reject invalid selections and result/stat injection before any update', async () => {
    const original = User.findOneAndUpdate;
    User.findOneAndUpdate = () => assert.fail('Invalid request reached database');
    const user = player({ badges: { 'first-blood': now } });
    try {
        for (const body of [null, [], {}, { equippedBadges: 'first-blood' },
            { equippedBadges: ['sovereign'] }, { equippedBadges: ['first-blood', 'first-blood'] },
            { equippedBadges: [{ $ne: null }] }, { equippedBadges: ['__proto__'] },
            { equippedBadges: ['a', 'b', 'c', 'd'] }, { equippedBadges: [], elo: 9999 }]) {
            const res = response(); await equipBadges({ body, user }, res); assert.equal(res.statusCode, 400);
        }
        for (const command of [reportRookeWin, syncBadges]) {
            for (const body of [{ userId: A }, { badges: ['sovereign'] }, { wins: 100 }, []]) {
                const res = response(); await command({ body, user }, res); assert.equal(res.statusCode, 400);
            }
        }
    } finally { User.findOneAndUpdate = original; }
});

test('Rooke win uses one pipeline update; repeats do not write and never alter multiplayer stats', async () => {
    const original = User.findOneAndUpdate;
    let calls = 0, captured;
    const user = player({ elo: 570, matches: 9, wins: 4, badgeProgress: { classicWins: 1, chaosWins: 1, winStreak: 2 } });
    User.findOneAndUpdate = (filter, update, options) => {
        calls++; captured = update;
        assert.deepEqual(filter, { _id: user._id });
        assert.equal(options.returnDocument, 'after'); assert.equal(options.updatePipeline, true);
        user.badges.set('rooke-awakening', now); user.badges.set('three-musketiers', now);
        return { select: async value => { assert.equal(value, '-password'); return user; } };
    };
    try {
        const res = response(); await reportRookeWin({ user, body: {} }, res);
        assert.equal(res.statusCode, 200); assert.equal(calls, 1);
        assert.deepEqual(Object.keys(captured[0].$set).sort(), ['badges.rooke-awakening', 'badges.three-musketiers']);
        assert.ok(captured[0].$set['badges.three-musketiers'].$cond);
        assert.deepEqual([user.elo, user.matches, user.wins, user.badgeProgress.winStreak], [570, 9, 4, 2]);
        await reportRookeWin({ user, body: {} }, response()); assert.equal(calls, 1);
    } finally { User.findOneAndUpdate = original; }
});

test('equipping writes only the selected IDs; opening an up-to-date collection performs no write', async () => {
    const original = User.findOneAndUpdate;
    const user = player({ badges: { 'first-blood': now, 'on-the-rise': now }, elo: 600, wins: 1 });
    let calls = 0;
    User.findOneAndUpdate = (filter, update, options) => {
        calls++; assert.deepEqual(update, { $set: { equippedBadges: ['on-the-rise', 'first-blood'] } });
        assert.equal(options.updatePipeline, false);
        user.equippedBadges = update.$set.equippedBadges;
        return { select: async () => user };
    };
    try {
        const res = response(); await equipBadges({ user, body: { equippedBadges: ['on-the-rise', 'first-blood'] } }, res);
        assert.equal(res.statusCode, 200); assert.equal(calls, 1);
        assert.deepEqual(equippedBadges(user), ['on-the-rise', 'first-blood']);
        await equipBadges({ user, body: { equippedBadges: [...user.equippedBadges] } }, response());
        await syncBadges({ user, body: {} }, response()); assert.equal(calls, 1);
    } finally { User.findOneAndUpdate = original; }
});

test('legacy counts backfill milestones in one update without scanning old games', async () => {
    const original = User.findOneAndUpdate;
    const user = player({ elo: 1000, matches: 150, wins: 100 });
    let calls = 0;
    User.findOneAndUpdate = (_filter, pipeline) => {
        calls++;
        assert.deepEqual(Object.keys(pipeline[0].$set).sort(), ['first-blood', 'on-the-rise', 'four-figures', 'getting-dangerous', 'centurion'].map(id => 'badges.' + id).sort());
        return { select: async () => user };
    };
    try { await syncBadges({ user, body: {} }, response()); assert.equal(calls, 1); }
    finally { User.findOneAndUpdate = original; }
});

test('leaderboard ties award all applicable tiers; existing awards cause no write operations', () => {
    const users = [
        { _id: A, username: 'A', elo: 1000, matches: 5, wins: 3 },
        { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', username: 'B', elo: 1000, matches: 5, wins: 3 },
        { _id: 'cccccccccccccccccccccccc', username: 'C', elo: 800, matches: 5, wins: 3 },
    ];
    const entries = publicEntries(users);
    const awards = leaderboardAwards(users, entries, now);
    assert.deepEqual(awards.map(op => Object.keys(op.updateOne.update[0].$set).length), [4, 4, 2]);
    assert.equal(JSON.stringify(entries).includes('badges'), false);
    users.forEach(user => { user.badges = Object.fromEntries(BADGE_IDS.map(id => [id, now])); });
    assert.deepEqual(leaderboardAwards(users, entries, now), []);
});

test('leaderboard awards share snapshot transaction; stale lease and write failures cannot grant awards', async () => {
    const session = {}; let modifiedCount = 1, writes = 0, transactions = 0, fail = false;
    const model = {
        db: { transaction: async work => { transactions++; return work(session); } },
        updateOne: async (_filter, _update, options) => { assert.equal(options?.session, session); return { modifiedCount }; },
    };
    const store = createMongoLeaderboardStore(model, { bulkWrite: async (ops, options) => {
        assert.equal(options.session, session); assert.equal(ops.length, 1); writes++;
        if (fail) throw new Error('Temporary database failure');
    } });
    const ops = leaderboardAwards([{ _id: A }], [{ userId: A, rank: 1 }], now);
    assert.equal(await store.publish('owner', 1000, [], ops), true);
    assert.equal(writes, 1); assert.equal(transactions, 1);
    modifiedCount = 0;
    assert.equal(await store.publish('expired', 1000, [], ops), false); assert.equal(writes, 1);
    modifiedCount = 1; fail = true;
    await assert.rejects(store.publish('owner', 1000, [], ops), /Temporary/);
});

test('reopening an older match merges awards without rolling back current stats or equipment', async () => {
    const compiled = await build({ entryPoints: ['src/lib/badges.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
    const { mergeAchievements } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
    const user = { _id: A, elo: 900, matches: 30, wins: 20, statsUpdatedAt: '2026-11-10T00:00:00Z', badges: { centurion: 'earned' }, equippedBadges: ['centurion'] };
    const old = { userId: A, elo: 600, matches: 6, wins: 4, statsUpdatedAt: now.toISOString(), badges: { 'on-the-rise': now.toISOString() }, badgeProgress: { winStreak: 1 } };
    const merged = mergeAchievements(user, old);
    assert.equal(merged.elo, 900); assert.equal(merged.matches, 30);
    assert.deepEqual(merged.equippedBadges, ['centurion']);
    assert.ok(merged.badges['on-the-rise']); assert.ok(merged.badges.centurion);
    assert.equal(mergeAchievements(user, { ...old, userId: 'another account' }), user);
});

test('Kestrel badge is standalone, idempotent, and leaves Rooke and multiplayer progression untouched', async () => {
    const original = User.findOneAndUpdate;
    let calls = 0;
    const user = player({ badgeProgress: { classicWins: 1, chaosWins: 1 } });
    User.findOneAndUpdate = (_filter, update) => {
        calls++;
        assert.deepEqual(Object.keys(update[0].$set), ['badges.kestrel-conqueror']);
        user.badges.set('kestrel-conqueror', now);
        return { select: async () => user };
    };
    try {
        await reportKestrelWin({ user, body: {} }, response());
        await reportKestrelWin({ user, body: {} }, response());
        assert.equal(calls, 1);
        assert.equal(badgeMap(user)['rooke-awakening'], undefined);
        assert.equal(badgeMap(user)['three-musketiers'], undefined);
        assert.deepEqual(grantMilestones(user, now), []);
        const invalid = response();
        await reportKestrelWin({ user, body: { wins: 99 } }, invalid);
        assert.equal(invalid.statusCode, 400);
    } finally { User.findOneAndUpdate = original; }
});

test('Merlin badge is standalone, idempotent, and leaves Rooke and multiplayer progression untouched', async () => {
    const original = User.findOneAndUpdate;
    let calls = 0;
    const user = player({ badgeProgress: { classicWins: 1, chaosWins: 1 } });
    User.findOneAndUpdate = (_filter, update) => {
        calls++;
        assert.deepEqual(Object.keys(update[0].$set), ['badges.merlin-conqueror']);
        user.badges.set('merlin-conqueror', now);
        return { select: async () => user };
    };
    try {
        await reportMerlinWin({ user, body: {} }, response());
        await reportMerlinWin({ user, body: {} }, response());
        assert.equal(calls, 1);
        assert.equal(badgeMap(user)['rooke-awakening'], undefined);
        assert.equal(badgeMap(user)['three-musketiers'], undefined);
        assert.deepEqual(grantMilestones(user, now), []);
        const invalid = response();
        await reportMerlinWin({ user, body: { wins: 99 } }, invalid);
        assert.equal(invalid.statusCode, 400);
    } finally { User.findOneAndUpdate = original; }
});
