import assert from 'node:assert/strict';
import { load, position, uci } from './engine-tools.mjs';
const { chooseOpeningMove, openingLines, openingMoveCaps } = load('opening_book');
const { legalMovesForPiece } = load('rules');
const { makeMove } = load('apply_move');
const { createGame, gameReducer } = load('game_state');
const { encodeMatch, decodeMatch, MATCH_SAVE_MS } = load('saved_match');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const initial = () => ({ ...position(START), plyCount: 0 });
const play = (p, move) => { makeMove(p.board, move, p.castling, p.standard); p.turn = p.turn === 'white' ? 'black' : 'white'; p.plyCount++; };
assert.deepEqual(openingMoveCaps, { rooke: 7, kestrel: 5, merlin: 5 });
assert.equal(openingLines.length, 50);
assert.equal(new Set(openingLines.map(line => line.moves)).size, 50, 'every imported line must add a distinct move sequence');
// Replay every imported branch through both colors, including captures and castles.
for (const line of openingLines) {
    const p = initial();
    const before = JSON.stringify(p);
    for (const moveUci of line.moves.split(' ')) {
        const snapshot = JSON.stringify(p);
        for (const bot of ['rooke', 'kestrel', 'merlin']) {
            const selected = chooseOpeningMove(p, bot, 719);
            assert.equal(Boolean(selected), p.plyCount < openingMoveCaps[bot] * 2, `${line.name} ${bot} ply ${p.plyCount}`);
            if (selected) assert.ok(legalMovesForPiece(p.board, selected.from, p.castling, p.standard).some(m => JSON.stringify(m) === JSON.stringify(selected)));
        }
        assert.equal(JSON.stringify(p), snapshot, 'lookup must not mutate the position');
        const from = (8 - Number(moveUci[1])) * 8 + 'abcdefgh'.indexOf(moveUci[0]);
        const move = legalMovesForPiece(p.board, from, p.castling, p.standard).find(m => uci(m) === moveUci);
        assert.ok(move, `${line.name}: ${moveUci}`);
        play(p, move);
    }
    assert.notEqual(JSON.stringify(p), before);
    assert.equal(p.plyCount, line.moves.split(' ').length);
    assert.ok(p.plyCount <= 14);
    if (p.plyCount === 14) assert.equal(chooseOpeningMove(p, 'rooke', 719), null);
}
// Seeded choices are reproducible, and their distribution follows the authored weights.
const counts = new Map();
const expected = new Map([['e2e4', 99], ['d2d4', 188], ['c2c4', 28], ['g1f3', 16]]);
const weightTotal = [...expected.values()].reduce((a, b) => a + b, 0);
const p = initial();
for (let seed = 1; seed <= 10000; seed++) {
    const selected = chooseOpeningMove(p, 'rooke', seed);
    for (const bot of ['rooke', 'kestrel', 'merlin']) assert.deepEqual(selected, chooseOpeningMove(p, bot, seed));
    const key = uci(selected); counts.set(key, (counts.get(key) ?? 0) + 1);
}
assert.deepEqual([...counts.keys()].sort(), [...expected.keys()].sort());
for (const [move, weight] of expected) assert.ok(Math.abs(counts.get(move) / 10000 - weight / weightTotal) < 0.025, `weight distribution for ${move}`);
// Root preferences must not reweight Black's replies or later opening branches.
const e4Weights = new Map();
for (const line of openingLines.filter(line => line.moves.startsWith('e2e4 '))) {
    const reply = line.moves.split(' ')[1];
    e4Weights.set(reply, (e4Weights.get(reply) ?? 0) + line.weight);
}
const afterE4 = initial();
play(afterE4, legalMovesForPiece(afterE4.board, 52, afterE4.castling, afterE4.standard).find(move => move.to === 36));
const replyCounts = new Map();
for (let seed = 1; seed <= 10000; seed++) {
    const reply = uci(chooseOpeningMove(afterE4, 'rooke', seed));
    replyCounts.set(reply, (replyCounts.get(reply) ?? 0) + 1);
}
const replyTotal = [...e4Weights.values()].reduce((a, b) => a + b, 0);
for (const [reply, weight] of e4Weights) assert.ok(Math.abs(replyCounts.get(reply) / 10000 - weight / replyTotal) < 0.025, `unchanged reply distribution for ${reply}`);
// Expansion covers common opponent replies, not just more names for late variations.
function choicesAfter(sequence) {
    const p = initial();
    for (const moveUci of sequence.split(' ')) {
        const from = (8 - Number(moveUci[1])) * 8 + 'abcdefgh'.indexOf(moveUci[0]);
        const move = legalMovesForPiece(p.board, from, p.castling, p.standard).find(m => uci(m) === moveUci);
        assert.ok(move);
        play(p, move);
    }
    return [...new Set(Array.from({ length: 1000 }, (_, seed) => uci(chooseOpeningMove(p, 'rooke', seed))))].sort();
}
assert.deepEqual(choicesAfter('e2e4'), ['e7e5', 'c7c5', 'e7e6', 'c7c6', 'd7d6', 'd7d5', 'g8f6'].sort());
assert.deepEqual(choicesAfter('e2e4 e7e6 d2d4 d7d5'), ['b1c3', 'e4e5', 'e4d5', 'b1d2'].sort());
assert.deepEqual(choicesAfter('d2d4 d7d5'), ['c2c4', 'g1f3'].sort());
// Unknown game age, Havoc, altered rights, and off-book positions fall through to search.
for (const plyCount of [undefined, -1, NaN, 0.5, 14, 100]) assert.equal(chooseOpeningMove({ ...p, plyCount }, 'rooke', 42), null);
assert.equal(chooseOpeningMove({ ...p, standard: undefined }, 'rooke', 42), null);
assert.equal(chooseOpeningMove({ ...p, standard: { ...p.standard, castlingRights: { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } } } }, 'rooke', 42), null);
assert.equal(chooseOpeningMove({ ...p, standard: { ...p.standard, enPassantTarget: 20 } }, 'rooke', 42), null);
const offBook = initial();
play(offBook, legalMovesForPiece(offBook.board, 48, offBook.castling, offBook.standard).find(m => m.to === 40));
assert.equal(chooseOpeningMove(offBook, 'rooke', 42), null);
// A repetition back to an early position cannot renew the allowance.
assert.equal(chooseOpeningMove({ ...initial(), plyCount: 16 }, 'rooke', 42), null);
assert.ok(chooseOpeningMove({ ...initial(), plyCount: 10 }, 'rooke', 42));
assert.equal(chooseOpeningMove({ ...initial(), plyCount: 10 }, 'kestrel', 42), null);
// Move age advances only on completed legal moves, survives saving, resets on restart.
let game = createGame(initial().board, 'white', undefined, 'normal');
assert.equal(game.plyCount, 0);
for (let i = 0; i < 12; i++) {
    const moveUci = openingLines[0].moves.split(' ')[i];
    const from = (8 - Number(moveUci[1])) * 8 + 'abcdefgh'.indexOf(moveUci[0]);
    const move = legalMovesForPiece(game.board, from, game.castling, game.standard).find(m => uci(m) === moveUci);
    assert.ok(move);
    game = gameReducer(game, { type: 'engine-move', move, expectedBoard: game.board, turn: game.turn });
    assert.equal(game.plyCount, i + 1);
}
const now = Date.now();
const saved = { game, botId: 'rooke', orientation: 'white', evaluationSeed: 123, expiresAt: now + MATCH_SAVE_MS };
const encoded = encodeMatch(saved), resumed = decodeMatch(encoded, now);
assert.equal(resumed.game.plyCount, 12);
assert.deepEqual(chooseOpeningMove(resumed.game, 'rooke', resumed.evaluationSeed), chooseOpeningMove(game, 'rooke', 123));
const legacy = JSON.parse(encoded); delete legacy.plyCount;
assert.equal(chooseOpeningMove(decodeMatch(JSON.stringify(legacy), now).game, 'rooke', 123), null);
for (const invalid of [-1, 0.5, '12']) assert.equal(decodeMatch(JSON.stringify({ ...legacy, plyCount: invalid }), now), null);
assert.equal(gameReducer(game, { type: 'restart', board: initial().board }).plyCount, 0);
console.log('Opening book: 50 distinct imported legal lines; common reply coverage; weighted variety; 5/7-move caps; fallback; save/resume passed.');
