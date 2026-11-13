import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import createKestrel from '../public/engines/kestrel.js';
import createMerlin from '../public/engines/merlin.js';
import { searchPosition as searchKestrel } from '../public/engines/kestrel-client.js';
import { searchPosition as searchMerlin } from '../public/engines/merlin-client.js';

const modules = new Map();
function load(name, base = new URL('../src/components/common/', import.meta.url)) {
    const url = new URL(`${name}.ts`, base);
    if (modules.has(url.href)) return modules.get(url.href);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(id => load(id, new URL('.', url)), loaded, loaded.exports);
    modules.set(url.href, loaded.exports);
    return loaded.exports;
}
const { chooseOpeningMove, openingSeed } = load('opening_variation');
const { parseFen, standardStateFromFen } = load('../utils/fen_parcer');
const { createGame, gameReducer } = load('game_state');
const { encodeMatch, decodeMatch, MATCH_SAVE_MS } = load('saved_match');
const { legalMovesForPiece } = load('rules');
const { applyMove } = load('apply_move');
const { cloneStandardState } = load('../utils/types');
const { evaluateBoard } = load('../utils/checkmate_eval');
const { createPieceSquareTables } = load('../utils/positional_eval');
const { searchBot, defaultBotSettings } = load('bot_search');
const { Engine } = load('engine');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const key = move => JSON.stringify(Object.fromEntries(Object.entries(move).sort()));
const seeds = Array.from({ length: 24 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0);
function request(normal, turn = 'white') {
    return { board: parseFen(START), standard: normal ? standardStateFromFen(START) : undefined,
        castling: { white: false, black: false }, halfmoveClock: 0, turn };
}
function moves(req) {
    return req.board.flatMap((piece, square) => piece && (piece > 0) === (req.turn === 'white')
        ? legalMovesForPiece(req.board, square, req.castling, req.standard) : []);
}
function child(req, move) {
    const castling = { ...req.castling }, standard = req.standard && cloneStandardState(req.standard);
    return { ...req, board: applyMove(req.board, move, castling, standard), castling, standard,
        turn: req.turn === 'white' ? 'black' : 'white' };
}

test('weighted selection excludes moves beyond the cutoff and preserves forced mates', () => {
    for (const cutoff of [40, 25, 12]) {
        const candidates = [{ move: 'best', score: 20 }, { move: 'near', score: 20 - cutoff / 2 },
            { move: 'edge', score: 20 - cutoff }, { move: 'bad', score: 19 - cutoff }];
        const counts = { best: 0, near: 0, edge: 0 };
        for (let i = 0; i < 4000; i++) {
            const seed = Math.imul(i, 0x9e3779b9) >>> 0;
            const selected = chooseOpeningMove(candidates, cutoff, seed);
            assert.notEqual(selected, 'bad'); counts[selected]++;
            assert.equal(chooseOpeningMove(candidates, cutoff, seed), selected);
        }
        assert.ok(counts.best > counts.near && counts.near > counts.edge && counts.edge > 0);
        for (const best of [999999, -999990]) for (const seed of seeds)
            assert.equal(chooseOpeningMove([{ move: 'mate', score: best }, { move: 'worse', score: best - 1 }], cutoff, seed), 'mate');
    }
    assert.equal(chooseOpeningMove([], 40, 1), null);
    for (const ply of [undefined, -1, 6, 7, 100, 0.5, NaN]) assert.equal(openingSeed(ply, 1), undefined);
    for (let ply = 0; ply < 6; ply++) assert.equal(typeof openingSeed(ply, 1), 'number');
});

test('total ply count survives pawn-clock resets, saves, promotions, and restarts', () => {
    let game = createGame(parseFen(START), 'white', undefined, 'normal');
    const now = Date.now();
    function roundTrip(game) {
        const raw = encodeMatch({ game, orientation: 'white', evaluationSeed: 12, expiresAt: now + MATCH_SAVE_MS });
        return { raw, restored: decodeMatch(raw, now).game };
    }
    for (const [from, to] of [[52, 36], [12, 28], [62, 45], [1, 18], [51, 35], [11, 27]]) {
        const ply = game.plyCount;
        game = gameReducer(game, { type: 'engine-move', move: { from, to, kind: 'm' }, expectedBoard: game.board, turn: game.turn });
        assert.equal(game.plyCount, ply + 1);
        game = roundTrip(game).restored;
        assert.equal(game.plyCount, ply + 1);
    }
    assert.equal(game.halfmoveClock, 0);
    assert.equal(openingSeed(game.plyCount, 12), undefined);
    const legacy = JSON.parse(roundTrip(game).raw); delete legacy.plyCount;
    assert.equal(decodeMatch(JSON.stringify(legacy), now).game.plyCount, 6);
    for (const plyCount of [-1, 0.5, '3']) assert.equal(decodeMatch(JSON.stringify({ ...legacy, plyCount }), now), null);
    assert.equal(gameReducer(game, { type: 'restart', board: parseFen(START) }).plyCount, 0);
    let promotion = createGame(parseFen('7k/P7/8/8/8/8/8/K7'), 'white', undefined, 'normal');
    promotion = gameReducer(promotion, { type: 'click', square: [1, 0] });
    promotion = gameReducer(promotion, { type: 'click', square: [0, 0] });
    assert.equal(promotion.plyCount, 0);
    promotion = roundTrip(promotion).restored;
    assert.equal(promotion.plyCount, 0);
    assert.equal(gameReducer(promotion, { type: 'promote', piece: 'queen' }).plyCount, 1);
    const havoc = createGame(parseFen(START));
    const rotation = moves({ ...havoc }).find(move => move.kind === 'rotate');
    assert.ok(rotation);
    assert.equal(gameReducer(havoc, { type: 'engine-move', move: rotation, expectedBoard: havoc.board, turn: havoc.turn }).plyCount, 1);
});

test('Rooke varies only within 40 centipawns for either color and variant, through ply five', () => {
    for (const normal of [false, true]) for (const turn of ['white', 'black']) {
        const req = request(normal, turn), before = JSON.stringify(req), selected = new Set();
        const settings = { ...defaultBotSettings, maxDepth: 1, maxTimeMs: 1000, quiescence: false };
        for (const evaluationSeed of seeds) {
            const options = { ...settings, standard: req.standard, castling: req.castling, evaluationSeed };
            const scored = moves(req).map(move => ({ move, score: (turn === 'white' ? 1 : -1)
                * evaluateBoard(child(req, move).board, undefined, 1, createPieceSquareTables(evaluationSeed), normal ? 'normal' : 'chaos') }));
            const best = Math.max(...scored.map(candidate => candidate.score));
            for (const plyCount of [0, 5]) {
                const result = searchBot({ ...req, settings, evaluationSeed, plyCount });
                assert.equal(result.completedDepth, 1);
                const candidate = scored.find(candidate => key(candidate.move) === key(result.move));
                assert.ok(candidate && best - candidate.score <= 40 + 1e-8);
                selected.add(key(result.move));
            }
            const baseline = Engine(req.board, turn, 1, undefined, options);
            assert.deepEqual(searchBot({ ...req, settings, evaluationSeed, plyCount: 6 }).move, baseline);
        }
        assert.ok(selected.size > 1);
        assert.equal(JSON.stringify(req), before);
        const timed = searchBot({ ...req, settings: { ...defaultBotSettings, maxTimeMs: 100 }, evaluationSeed: 12, plyCount: 0 });
        assert.ok(timed.completedDepth > 0);
        assert.deepEqual(timed.move, Engine(req.board, turn, timed.completedDepth, undefined, {
            ...defaultBotSettings, ...req, evaluationSeed: 12, maxTimeMs: 10000,
            openingVariation: { cutoff: 40, seed: openingSeed(0, 12) },
        }));
    }
});

for (const [name, create, search, cutoff, variants] of [
    ['Kestrel', createKestrel, searchKestrel, 25, [false, true]],
    ['Merlin', createMerlin, searchMerlin, 12, [true]],
]) test(`${name} uses exact near-equal scores, varies both colors, and disables variation at ply six`, async () => {
    const engine = await create(); engine[`_${name.toLowerCase()}_init`]();
    for (const normal of variants) for (const turn of ['white', 'black']) {
        const req = request(normal, turn), before = JSON.stringify(req), selected = new Set();
        const limits = { timeMs: 1000, maxDepth: 2 };
        // Independent child searches provide an oracle for root candidates at depth two.
        const scored = moves(req).map(move => ({ move, score: -search(engine, { ...child(req, move), timeMs: 1000, maxDepth: 1 }).score }));
        const best = Math.max(...scored.map(candidate => candidate.score));
        for (const evaluationSeed of seeds) for (const plyCount of [0, 5]) {
            const result = search(engine, { ...req, ...limits, evaluationSeed, plyCount });
            assert.equal(result.depth, 2);
            const candidate = scored.find(candidate => key(candidate.move) === key(result.move));
            assert.ok(candidate && best - candidate.score <= cutoff, `${name}: selected score ${candidate?.score}, best ${best}`);
            assert.equal(result.score, candidate.score || 0);
            selected.add(key(result.move));
            assert.deepEqual(search(engine, { ...req, ...limits, evaluationSeed, plyCount }).move, result.move);
        }
        assert.ok(selected.size > 1);
        const baseline = search(engine, { ...req, ...limits });
        for (const evaluationSeed of seeds.slice(0, 3)) assert.deepEqual(search(engine, { ...req, ...limits, evaluationSeed, plyCount: 6 }).move, baseline.move);
        const timed = search(engine, { ...req, timeMs: 25, evaluationSeed: 12, plyCount: 0 });
        assert.ok(timed.depth > 0 && timed.elapsedMs < 250);
        assert.ok(moves(req).some(move => key(move) === key(timed.move)));
        assert.deepEqual(timed.move, search(engine, { ...req, timeMs: 1000, maxDepth: timed.depth, evaluationSeed: 12, plyCount: 0 }).move);
        assert.equal(JSON.stringify(req), before);
    }
    const mate = { ...request(true), board: parseFen('7k/5Q2/6K1/8/8/8/8/8'), plyCount: 0 };
    for (const evaluationSeed of seeds.slice(0, 3)) assert.ok(search(engine, { ...mate, timeMs: 100, maxDepth: 4, evaluationSeed }).score > 999900);
    const checkmated = search(engine, { ...mate, board: parseFen('7k/6Q1/6K1/8/8/8/8/8'), turn: 'black', timeMs: 100, maxDepth: 4 });
    assert.equal(checkmated.move, null); assert.ok(checkmated.score < -999900);
    const stalemated = search(engine, { ...mate, turn: 'black', timeMs: 100, maxDepth: 4 });
    assert.equal(stalemated.move, null); assert.equal(stalemated.score, 0);
});
