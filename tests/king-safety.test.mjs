import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Load the project's TypeScript modules without changing the Next.js compiler setup.
const modules = new Map();
function load(name, base = new URL('../src/components/common/', import.meta.url)) {
    const url = new URL(`${name}.ts`, base);
    if (modules.has(url.href)) return modules.get(url.href);
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(
        id => load(id, new URL('.', url)), loadedModule, loadedModule.exports,
    );
    modules.set(url.href, loadedModule.exports);
    return loadedModule.exports;
}

const { makePiece, pieceDefinitions, pieceIds, pieceColor, pieceName, pieceValue, MATE_SCORE } = load('../utils/pieces');
const { parseFen } = load('../utils/fen_parcer');
const { applyMove, makeMove } = load('apply_move');
const { findKing, isKingSafe } = load('../utils/king_safety');
const generate = load('legal_move').default;
const generateNormal = load('normal/normal_legal_move').default;
const normalKingSafe = load('normal/normal_king_safety').isKingSafe;
const { createStandardState, cloneStandardState, createCastlingState } = load('../utils/types');
const { Engine: engineSearch, createSearchStats, SearchTimeoutError, QuiescenceLimitError, movePriority } = load('engine');
// Keep the original static-depth regressions explicit; dedicated quiescence tests opt in below.
function Engine(board, turn, depth, stats, options = {}) {
    return engineSearch(board, turn, depth, stats, { quiescence: false, ...options });
}
const { parseBenchmarkFen, benchmarkPositions } = load('benchmark_positions');
const { runBenchmark } = load('benchmark');
const { saveUndoInformation, unmakeMove } = load('legal_move');
const { createGame, gameReducer, getGameStatus, gameResultScore } = load('game_state');
const { endgameWeight, evaluateBoard, ForceKingToCheckmateEval } = load('../utils/checkmate_eval');

function position(...pieces) {
    const board = Array(64).fill(0);
    for (const [row, col, piece] of pieces) board[row * 8 + col] = piece;
    return board;
}

test('standard pawns advance forward and double only from a clear starting rank', () => {
    for (const color of ['white', 'black']) {
        const sign = color === 'white' ? 1 : -1;
        const from = color === 'white' ? 52 : 12;
        const step = color === 'white' ? -8 : 8;
        const board = position([7, 4, 7], [0, 4, -7]);
        board[from] = sign;
        const destinations = () => generateNormal(board, from).map(move => move.to).sort((a, b) => a - b);
        const before = board.slice();
        assert.deepEqual(destinations(), [from + step, from + 2 * step].sort((a, b) => a - b));
        assert.deepEqual(board, before);
        board[from + 2 * step] = 2 * sign;
        assert.deepEqual(destinations(), [from + step]);
        board[from + step] = 2 * sign;
        assert.deepEqual(destinations(), []);
        board[from] = 0;
        board[from + step] = sign;
        board[from + 2 * step] = 0;
        assert.deepEqual(generateNormal(board, from + step).map(move => move.to), [from + 2 * step]);
    }
});

test('standard pawn captures stay on the board at both file edges', () => {
    for (const [from, wrapped, capture] of [[32, 23, 25], [39, 32, 30], [24, 31, 33], [31, 40, 38]]) {
        const sign = from >= 32 ? 1 : -1;
        const board = position([7, 4, 7], [0, 4, -7]);
        board[from] = sign;
        board[wrapped] = -4 * sign;
        board[capture] = -4 * sign;
        const moves = generateNormal(board, from);
        assert.ok(moves.some(move => move.to === capture && move.kind === 'c'));
        assert.ok(!moves.some(move => move.to === wrapped));
    }
});

test('standard safety and legal king moves use diagonal pawn attacks independently of Chaos', () => {
    for (const sign of [1, -1]) {
        const color = sign === 1 ? 'white' : 'black';
        const king = sign === 1 ? 36 : 28;
        const enemyPawnRowOffset = sign === 1 ? -8 : 8;
        const board = Array(64).fill(0);
        board[king] = 7 * sign;
        board[sign === 1 ? 0 : 63] = -7 * sign;
        board[king + enemyPawnRowOffset + 1] = -sign;
        assert.equal(normalKingSafe(board, color), false);
        assert.equal(isKingSafe(board, color), true);
        board[king + enemyPawnRowOffset + 1] = 0;
        board[king + enemyPawnRowOffset] = -sign;
        assert.equal(normalKingSafe(board, color), true);
        assert.equal(isKingSafe(board, color), false);
    }
    const board = position([5, 4, 7], [0, 0, -7], [3, 5, -1]);
    assert.ok(!generateNormal(board, 44).some(move => move.to === 36));
    assert.ok(generate(board, 44).some(move => move.to === 36));
});

test('shared undo records independently restore nested captures, jumps, and rotations', () => {
    const board = position([7, 4, makePiece('king', 'white')], [0, 4, makePiece('king', 'black')],
        [7, 0, makePiece('rook', 'white')], [6, 0, makePiece('pawn', 'black')],
        [0, 7, makePiece('rook', 'black')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'black')]);
    const moves = [
        { from: 56, to: 48, kind: 'c' },
        { from: 7, to: 15, kind: 'm' },
        { from: 42, to: 28, kind: 'ch' },
        { from: 48, to: 48, kind: 'rotate', piece: 'diagonalrook' },
    ];
    const stack = [];
    for (const move of moves) {
        const before = board.slice();
        const undo = saveUndoInformation(board, move);
        makeMove(board, move);
        assert.notDeepEqual(board, before);
        stack.push({ move, undo, before });
    }
    while (stack.length) {
        const { move, undo, before } = stack.pop();
        unmakeMove(board, move, undo);
        assert.deepEqual(board, before);
    }
});

test('material and terminal scores consistently use White\'s perspective', () => {
    assert.equal(pieceValue(0), 0);
    for (const [name, definition] of Object.entries(pieceDefinitions)) {
        assert.ok(name === 'king' ? definition.value === 0 : definition.value > 0);
        assert.equal(pieceValue(makePiece(name, 'white')), definition.value);
        assert.equal(pieceValue(makePiece(name, 'black')), definition.value === 0 ? 0 : -definition.value);
    }
    assert.equal(pieceValue(makePiece('king', 'white')), 0);
    assert.equal(pieceValue(makePiece('king', 'black')), 0);
    assert.equal(pieceDefinitions.rook.value, pieceDefinitions.diagonalrook.value);
    const materialBound = 62 * Math.max(...Object.entries(pieceDefinitions).filter(([name]) => name !== 'king').map(([, piece]) => piece.value));
    for (const loser of ['white', 'black']) {
        const winner = loser === 'white' ? 'black' : 'white';
        const board = position([0, 0, makePiece('king', loser)], [0, 2, makePiece('rook', winner)], [1, 2, makePiece('rook', winner)], [7, 7, makePiece('king', winner)]);
        const score = gameResultScore(getGameStatus(board, loser));
        assert.equal(score, winner === 'white' ? MATE_SCORE : -MATE_SCORE);
        assert.ok(Math.abs(score) > materialBound);
    }
    assert.equal(gameResultScore({ kind: 'stalemate' }), 0);
    assert.equal(gameResultScore({ kind: 'playing' }), null);
    assert.equal(gameResultScore({ kind: 'check' }), null);
});

test('known king squares avoid scans and must match the resulting board', () => {
    const board = position([7, 4, makePiece('king', 'white')], [0, 4, makePiece('king', 'black')]);
    assert.equal(findKing(board, pieceIds.king), 60);
    assert.equal(findKing(board, -pieceIds.king), 4);
    assert.equal(findKing(position(), pieceIds.king), -1);
    board.indexOf = () => { throw new Error('Unexpected king search'); };
    assert.equal(isKingSafe(board, 'white', 60), true);
    assert.equal(isKingSafe(board, 'black', 4), true);
    assert.equal(isKingSafe(board, 'white', -1), false);
    assert.equal(isKingSafe(board, 'white', 4), false);
    const moved = applyMove(board, { from: 60, to: 59, kind: 'm' });
    assert.equal(isKingSafe(moved, 'white', 60), false);
    assert.equal(isKingSafe(moved, 'white', 59), true);
});

test('move generation locates each king once, regardless of candidate count', () => {
    for (const color of ['white', 'black']) {
        const board = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 3, makePiece('rook', color)]);
        let searches = 0;
        board.indexOf = function (...args) {
            searches++;
            return Array.prototype.indexOf.apply(this, args);
        };
        assert.ok(generate(board, 35).length > 10);
        // One lookup for each king, with no further lookups for candidate moves.
        assert.equal(searches, 2);
    }
});

for (const color of ['white', 'black']) {
    const enemy = color === 'white' ? 'black' : 'white';
    for (const [type, row, col, safe] of [
        ['rook', 4, 0, false],
        ['rook', 1, 1, true],
        ['diagonalrook', 1, 1, false],
        ['diagonalrook', 4, 0, true],
        ['queen', 4, 0, false],
        ['queen', 2, 3, false],
        ['queen', 1, 1, true],
        ['knight', 2, 2, false],
        ['knight', 4, 2, false],
        ['knight', 1, 1, true],
        ['knight', 2, 3, true],
        ['king', 3, 3, false],
        ['king', 2, 2, true],
    ]) {
        test(`${color} king: ${enemy} ${type} at ${row},${col}, safe=${safe}`, () => {
            const board = position([4, 4, makePiece('king', color)], [row, col, makePiece(type, enemy)]);
            assert.equal(isKingSafe(board, color), safe);
        });
    }

    test(`${color} king: pawn direction and capture pattern`, () => {
        const sourceRow = enemy === 'white' ? 5 : 3;
        assert.equal(isKingSafe(position([4, 4, makePiece('king', color)], [sourceRow, 4, makePiece('pawn', enemy)]), color), false);
        assert.equal(isKingSafe(position([4, 4, makePiece('king', color)], [sourceRow, 3, makePiece('pawn', enemy)]), color), true);
        assert.equal(isKingSafe(position([4, 4, makePiece('king', color)], [8 - sourceRow, 4, makePiece('pawn', enemy)]), color), true);
    });
}

test('both friendly and enemy pieces block attack rays and short-range knights', () => {
    for (const blocker of [makePiece('pawn', 'white'), makePiece('pawn', 'black')]) {
        for (const attacker of [makePiece('rook', 'black'), makePiece('knight', 'black')]) {
            const board = position([4, 4, makePiece('king', 'white')], [4, 2, attacker], [4, 3, blocker]);
            assert.equal(isKingSafe(board, 'white'), true);
        }
    }
});

test('checkers attacks require an on-board empty landing square in every direction', () => {
    for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
        const board = position([4, 4, makePiece('king', 'white')], [4 + dr, 4 + dc, makePiece('bishop', 'black')]);
        assert.equal(isKingSafe(board, 'white'), false);
        board[(4 - dr) * 8 + (4 - dc)] = makePiece('pawn', 'white');
        assert.equal(isKingSafe(board, 'white'), true);
    }
    assert.equal(isKingSafe(position([0, 0, makePiece('king', 'white')], [1, 1, makePiece('bishop', 'black')]), 'white'), true);
});

test('missing king is unsafe; all edge squares are checked without wrapping', () => {
    assert.equal(isKingSafe(position(), 'white'), false);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        assert.equal(isKingSafe(position([r, c, makePiece('king', 'white')]), 'white'), true);
    }
});

test('a pinned rook can stay on the ray or capture its attacker, but cannot leave the ray', () => {
    const board = position([7, 4, makePiece('king', 'white')], [6, 4, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')]);
    const snapshot = structuredClone(board);
    const moves = generate(board, 52);
    assert.ok(moves.some((m) => m.to === 4 && m.kind === 'c'));
    assert.ok(moves.some((m) => m.to === 44 && m.kind === 'm'));
    assert.ok(moves.every((m) => m.to % 8 === 4));
    assert.deepEqual(board, snapshot);
});

test('a move must resolve an existing check, including by blocking it', () => {
    const board = position([7, 4, makePiece('king', 'white')], [6, 0, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')]);
    assert.deepEqual(generate(board, 48), [{ from: 48, to: 52, kind: 'm' }]);
});

test('king moves are checked after vacating the origin and after captures', () => {
    const board = position([4, 4, makePiece('king', 'white')], [4, 0, makePiece('rook', 'black')], [3, 4, makePiece('pawn', 'black')], [0, 4, makePiece('rook', 'black')]);
    const moves = generate(board, 36);
    assert.ok(!moves.some((m) => m.to === 37)); // Origin previously blocked this ray.
    assert.ok(!moves.some((m) => m.to === 28)); // Capturing exposes the protecting rook.
    const capture = generate(position([4, 4, makePiece('king', 'white')], [3, 4, makePiece('pawn', 'black')]), 36);
    assert.ok(capture.some((m) => m.to === 28 && m.kind === 'c'));
});

test('pinned enemies still attack and kings cannot become adjacent or be captured', () => {
    const board = position([4, 4, makePiece('king', 'white')], [3, 3, makePiece('knight', 'black')], [0, 3, makePiece('king', 'black')], [7, 3, makePiece('rook', 'white')]);
    assert.equal(isKingSafe(board, 'white'), false);
    const kings = position([4, 4, makePiece('king', 'white')], [2, 4, makePiece('king', 'black')]);
    assert.ok(!generate(kings, 36).some((m) => m.to === 28));
    const capture = position([7, 7, makePiece('king', 'white')], [4, 4, makePiece('rook', 'white')], [4, 0, makePiece('king', 'black')]);
    assert.ok(!generate(capture, 36).some((m) => m.to === 32));
});

test('checkers capture removes the jumped piece before checking for exposed attacks', () => {
    const board = position([4, 7, makePiece('king', 'white')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'black')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(!generate(board, 42).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4 * 8 + 0] = 0;
    assert.ok(generate(board, 42).some((m) => m.to === 28 && m.kind === 'ch'));
});

test('checkers capture can resolve check, but cannot capture the enemy king', () => {
    const board = position([4, 7, makePiece('king', 'white')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('rook', 'black')]);
    assert.ok(generate(board, 42).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4 * 8 + 3] = makePiece('king', 'black');
    assert.ok(!generate(board, 42).some((m) => m.kind === 'ch'));
});

test('moving into a checkers landing square can stop its threat', () => {
    const board = position([4, 4, makePiece('king', 'white')], [3, 3, makePiece('bishop', 'black')], [5, 7, makePiece('rook', 'white')]);
    assert.equal(isKingSafe(board, 'white'), false);
    assert.ok(generate(board, 47).some((m) => m.to === 45));
});

test('rotation is simulated without removing the rook and cannot ignore check', () => {
    const board = position([7, 4, makePiece('king', 'white')], [6, 4, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')]);
    const snapshot = structuredClone(board);
    assert.ok(generate(board, 52).some((m) => m.kind === 'rotate' && m.piece === 'diagonalrook'));
    board[6 * 8 + 4] = makePiece('diagonalrook', 'white');
    assert.ok(generate(board, 52).some((m) => m.kind === 'rotate' && m.piece === 'rook'));
    board[6 * 8 + 4] = 0;
    board[6 * 8 + 0] = makePiece('rook', 'white');
    assert.ok(!generate(board, 48).some((m) => m.kind === 'rotate'));
    assert.equal(snapshot[6 * 8 + 4], makePiece('rook', 'white'));
});

const click = (state, row, col) => gameReducer(state, { type: 'click', square: [row, col] });

test('local play starts with white and only the active color can be selected', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 3, makePiece('pawn', 'white')], [1, 3, makePiece('pawn', 'black')]));
    assert.equal(state.turn, 'white');
    assert.equal(click(state, 1, 3), state);
    assert.equal(click(state, 4, 4), state);
    assert.deepEqual(click(state, 6, 3).selectedSquare, [6, 3]);
});

test('returning a piece to its origin cancels without changing turn, board, or last move', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 3, makePiece('pawn', 'white')]));
    const cancelled = click(click(state, 6, 3), 6, 3);
    assert.deepEqual(cancelled, state);
    assert.equal(cancelled.board, state.board);
});

test('illegal placement retains selection and does not spend a turn', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 3, makePiece('pawn', 'white')]));
    const selected = click(state, 6, 3);
    assert.equal(click(selected, 5, 3), selected); // Custom pawns cannot advance straight.
    assert.equal(click(selected, 7, 7), selected); // Friendly occupied destination.
    assert.equal(click(selected, -1, 3), selected);
});

test('legal white and black moves alternate turns, clear selection, and record the last move', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 3, makePiece('pawn', 'white')], [1, 3, makePiece('pawn', 'black')]));
    const snapshot = structuredClone(state);
    const afterWhite = click(click(state, 6, 3), 5, 2);
    assert.equal(afterWhite.turn, 'black');
    assert.equal(afterWhite.selectedSquare, null);
    assert.equal(afterWhite.board[6 * 8 + 3], 0);
    assert.equal(afterWhite.board[5 * 8 + 2], makePiece('pawn', 'white'));
    assert.deepEqual(afterWhite.lastMove, { from: 51, to: 42, kind: 'm' });
    assert.equal(click(afterWhite, 5, 2), afterWhite);
    const afterBlack = click(click(afterWhite, 1, 3), 2, 2);
    assert.equal(afterBlack.turn, 'white');
    assert.equal(afterBlack.board[2 * 8 + 2], makePiece('pawn', 'black'));
    assert.deepEqual(state, snapshot);
});

test('live checkers capture removes the jumped piece and spends one turn', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'black')]));
    const next = click(click(state, 5, 2), 3, 4);
    assert.equal(next.board[5 * 8 + 2], 0);
    assert.equal(next.board[4 * 8 + 3], 0);
    assert.equal(next.board[3 * 8 + 4], makePiece('bishop', 'white'));
    assert.equal(next.lastMove.kind, 'ch');
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(state.board[4 * 8 + 3], makePiece('pawn', 'black'));
});

test('live ordinary capture replaces its target', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 2, makePiece('rook', 'white')], [4, 4, makePiece('pawn', 'black')]));
    const next = click(click(state, 4, 2), 4, 4);
    assert.equal(next.board[4 * 8 + 2], 0);
    assert.equal(next.board[4 * 8 + 4], makePiece('rook', 'white'));
    assert.equal(next.lastMove.kind, 'c');
    assert.equal(next.turn, 'black');
});

test('live play rejects moves exposing the king', () => {
    const state = createGame(position([7, 4, makePiece('king', 'white')], [6, 4, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')], [0, 0, makePiece('king', 'black')]));
    const selected = click(state, 6, 4);
    assert.equal(click(selected, 6, 5), selected);
});

test('rook switching is a separate action that transforms in place and spends the turn', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 0, makePiece('rook', 'white')]));
    assert.equal(gameReducer(state, { type: 'rotate' }), state);
    const selected = click(state, 6, 0);
    const next = gameReducer(selected, { type: 'rotate' });
    assert.equal(next.board[6 * 8 + 0], makePiece('diagonalrook', 'white'));
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(click(selected, 6, 0).turn, 'white');
    const pawn = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 0, makePiece('pawn', 'white')]));
    const selectedPawn = click(pawn, 6, 0);
    assert.equal(gameReducer(selectedPawn, { type: 'rotate' }), selectedPawn);
});

test('check with an escape is not checkmate', () => {
    const board = position([0, 0, makePiece('king', 'black')], [0, 2, makePiece('rook', 'white')], [7, 7, makePiece('king', 'white')]);
    assert.deepEqual(getGameStatus(board, 'black'), { kind: 'check' });
    const state = createGame(board, 'black');
    const escaped = click(click(state, 0, 0), 1, 0);
    assert.equal(escaped.board[1 * 8 + 0], makePiece('king', 'black'));
    assert.equal(escaped.turn, 'white');
});

test('checkmate is detected for either color', () => {
    for (const loser of ['white', 'black']) {
        const winner = loser === 'white' ? 'black' : 'white';
        const board = position([0, 0, makePiece('king', loser)], [0, 2, makePiece('rook', winner)], [1, 2, makePiece('rook', winner)], [7, 7, makePiece('king', winner)]);
        assert.deepEqual(getGameStatus(board, loser), { kind: 'checkmate', winner });
        assert.deepEqual(createGame(board, loser).status, { kind: 'checkmate', winner });
    }
});

test('a completed move detects mate and freezes all further board actions', () => {
    const board = position([0, 0, makePiece('king', 'black')], [0, 2, makePiece('rook', 'white')], [2, 2, makePiece('rook', 'white')], [7, 7, makePiece('king', 'white')]);
    const next = click(click(createGame(board), 2, 2), 1, 2);
    assert.deepEqual(next.status, { kind: 'checkmate', winner: 'white' });
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(click(next, 0, 0), next);
    assert.equal(gameReducer(next, { type: 'rotate' }), next);
});

test('a completed move detects stalemate using custom knight attacks', () => {
    const board = position([0, 0, makePiece('king', 'black')], [3, 1, makePiece('knight', 'white')], [7, 7, makePiece('king', 'white')]);
    const next = click(click(createGame(board), 3, 1), 2, 1);
    assert.equal(next.turn, 'black');
    assert.deepEqual(next.status, { kind: 'stalemate' });
    assert.equal(isKingSafe(next.board, 'black'), true);
    assert.equal(click(next, 0, 0), next);
});

test('a legal rook rotation prevents stalemate even when no piece can move', () => {
    const board = Array(64).fill(makePiece('pawn', 'white'));
    board[0 * 8 + 0] = makePiece('king', 'white');
    board[7 * 8 + 7] = makePiece('king', 'black');
    board[3 * 8 + 3] = makePiece('rook', 'white');
    assert.deepEqual(generate(board, 27), [{ from: 27, to: 27, kind: 'rotate', piece: 'diagonalrook' }]);
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'playing' });
    board[3 * 8 + 3] = makePiece('pawn', 'white');
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'stalemate' });
});

test('rotation also evaluates whether the opponent is now in check', () => {
    const board = position([7, 7, makePiece('king', 'white')], [0, 0, makePiece('king', 'black')], [2, 2, makePiece('rook', 'white')]);
    const state = createGame(board);
    const next = gameReducer(click(state, 2, 2), { type: 'rotate' });
    assert.equal(next.board[2 * 8 + 2], makePiece('diagonalrook', 'white'));
    assert.equal(next.turn, 'black');
    assert.equal(next.status.kind, 'check');
});

test('restart clears the result, last move, and selection and starts White', () => {
    const ended = createGame(position([0, 0, makePiece('king', 'black')], [2, 1, makePiece('knight', 'white')], [7, 7, makePiece('king', 'white')]), 'black');
    assert.equal(ended.status.kind, 'stalemate');
    const board = position([0, 0, makePiece('king', 'black')], [1, 0, makePiece('pawn', 'black')], [7, 7, makePiece('king', 'white')]);
    const next = gameReducer(ended, { type: 'restart', board });
    assert.deepEqual(next, createGame(board));
    assert.equal(next.turn, 'white');
    assert.equal(next.status.kind, 'playing');
    assert.deepEqual(click(next, 7, 7).selectedSquare, [7, 7]);
});

test('bishops of either color can jump allies in all four directions without capturing', () => {
    for (const color of ['white', 'black']) {
        for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
            const board = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', color)], [4 + dr, 4 + dc, makePiece('pawn', color)]);
            const toRow = 4 + dr * 2, toCol = 4 + dc * 2;
            const move = generate(board, 36).find((m) => m.to === toRow * 8 + toCol);
            assert.equal(move?.kind, 'm');
            const next = click(click(createGame(board, color), 4, 4), toRow, toCol);
            assert.equal(next.board[4 * 8 + 4], 0);
            assert.equal(next.board[(4 + dr) * 8 + (4 + dc)], makePiece('pawn', color));
            assert.equal(next.board[toRow * 8 + toCol], makePiece('bishop', color));
            assert.equal(next.turn, color === 'white' ? 'black' : 'white');
            assert.equal(next.selectedSquare, null);
            assert.equal(board[4 * 8 + 4], makePiece('bishop', color));
        }
    }
});

test('allied jumps require an empty on-board landing square and cannot jump empty squares', () => {
    for (const blocker of [makePiece('pawn', 'white'), makePiece('pawn', 'black')]) {
        const board = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', 'white')], [3, 3, makePiece('pawn', 'white')], [2, 2, blocker]);
        assert.ok(!generate(board, 36).some((m) => m.to === 18));
    }
    const edge = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 1, makePiece('bishop', 'white')], [0, 0, makePiece('pawn', 'white')]);
    assert.ok(generate(edge, 9).every((m) => m.to >= 0 && m.to < 64));
    const empty = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', 'white')]);
    assert.ok(!generate(empty, 36).some((m) => m.to === 18));
});

test('allied jumps preserve king safety, including jumping over your own king', () => {
    const blocked = position([4, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'white')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(generate(blocked, 42).some((m) => m.to === 28 && m.kind === 'm'));
    const pinned = position([4, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 3, makePiece('bishop', 'white')], [3, 2, makePiece('pawn', 'white')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(!generate(pinned, 35).some((m) => m.to === 17));
    const kingJump = position([3, 3, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 0, makePiece('pawn', 'black')], [4, 4, makePiece('bishop', 'white')]);
    const next = click(click(createGame(kingJump), 4, 4), 2, 2);
    assert.equal(next.board[3 * 8 + 3], makePiece('king', 'white'));
    assert.equal(next.board[2 * 8 + 2], makePiece('bishop', 'white'));
});

for (const color of ['white', 'black']) {
    const enemy = color === 'white' ? 'black' : 'white';
    const row = color === 'white' ? 1 : 6;
    const endRow = color === 'white' ? 0 : 7;
    const kingRow = color === 'white' ? 7 : 0;
    for (const capture of [false, true]) {
        test(`${color} pawn ${capture ? 'capture' : 'move'} pauses for promotion and blocks other moves`, () => {
            const board = position([kingRow, 7, makePiece('king', color)], [endRow, 7, makePiece('king', enemy)], [row, capture ? 0 : 1, makePiece('pawn', color)]);
            if (capture) board[endRow * 8 + 0] = makePiece('knight', enemy);
            let state = createGame(board, color);
            state = gameReducer(state, { type: 'click', square: [row, capture ? 0 : 1] });
            state = gameReducer(state, { type: 'click', square: [endRow, 0] });
            assert.deepEqual(state.pendingPromotion.square, [endRow, 0]);
            assert.equal(state.pendingPromotion.color, color);
            assert.equal(state.pendingPromotion.boardBefore, board);
            assert.equal(state.pendingPromotion.moves.length, 4);
            assert.equal(state.turn, color);
            assert.equal(state.board[endRow * 8 + 0], makePiece('pawn', color));
            assert.equal(state.selectedSquare, null);
            assert.equal(gameReducer(state, { type: 'click', square: [kingRow, 7] }), state);
            assert.equal(gameReducer(state, { type: 'rotate' }), state);
            assert.equal(gameReducer(state, { type: 'promote', piece: 'king' }), state);
            for (const piece of ['queen', 'rook', 'bishop', 'knight']) {
                const promoted = gameReducer(state, { type: 'promote', piece });
                assert.equal(promoted.board[endRow * 8 + 0], makePiece(piece, color));
                assert.equal(promoted.pendingPromotion, null);
                assert.equal(promoted.turn, enemy);
                assert.deepEqual(promoted.lastMove, { ...state.lastMove, promotion: piece });
                assert.equal(state.board[endRow * 8 + 0], makePiece('pawn', color), 'promotion must not mutate the pending board');
            }
            assert.equal(gameReducer(state, { type: 'restart', board }).pendingPromotion, null);
        });
    }
}

test('a rook moving to or rotating on the back rank does not trigger promotion', () => {
    let state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 0, makePiece('rook', 'white')]));
    state = gameReducer(state, { type: 'click', square: [1, 0] });
    state = gameReducer(state, { type: 'click', square: [0, 0] });
    assert.equal(state.pendingPromotion, null);
    assert.equal(state.turn, 'black');
    let black = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [0, 0, makePiece('rook', 'black')]), 'black');
    black = gameReducer(black, { type: 'click', square: [0, 0] });
    black = gameReducer(black, { type: 'rotate' });
    assert.equal(black.pendingPromotion, null);
    assert.equal(black.turn, 'white');
});

test('checkmate is evaluated after the chosen promotion piece is placed', () => {
    let state = createGame(position([2, 1, makePiece('king', 'white')], [2, 3, makePiece('knight', 'white')], [1, 2, makePiece('pawn', 'white')], [0, 0, makePiece('king', 'black')]));
    state = gameReducer(state, { type: 'click', square: [1, 2] });
    state = gameReducer(state, { type: 'click', square: [0, 1] });
    assert.ok(state.pendingPromotion);
    assert.equal(state.turn, 'white');
    state = gameReducer(state, { type: 'promote', piece: 'queen' });
    assert.deepEqual(state.status, { kind: 'checkmate', winner: 'white' });
    assert.equal(state.turn, 'black');
    assert.equal(state.pendingPromotion, null);
    assert.equal(gameReducer(state, { type: 'click', square: [0, 0] }), state);
});

test('promotion without a pending pawn does nothing', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')]));
    assert.equal(gameReducer(state, { type: 'promote', piece: 'queen' }), state);
});


test('FEN creates signed numeric pieces and zero empty squares', () => {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    assert.equal(board.length, 64);
    assert.deepEqual(board.slice(0, 8), [-4, -2, -3, -6, -7, -3, -2, -4]);
    assert.deepEqual(board.slice(56, 64), [4, 2, 3, 6, 7, 3, 2, 4]);
    assert.deepEqual(board.slice(16, 24), Array(8).fill(0));
    assert.ok(board.every(Number.isInteger));
    assert.throws(() => parseFen('8/8/8/8/8/8/8/7x'), /Unknown FEN piece/);
    assert.throws(() => parseFen('8/8/8'), /eight ranks/);
});

test('flat square indices preserve board edges without wrapping across ranks', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [0, 0, makePiece('rook', 'white')]);
    const rookMoves = generate(board, 0).filter(move => move.kind !== 'rotate');
    assert.ok(rookMoves.some(move => move.to === 6));
    assert.ok(rookMoves.some(move => move.to === 48));
    assert.ok(rookMoves.every(move => Math.floor(move.to / 8) === 0 || move.to % 8 === 0));
    assert.deepEqual(generate(board, 56).map(move => move.to).sort((a, b) => a - b), [48, 49, 57]);
    assert.equal(board.length, 64);
});

test('all registered forms have unique IDs, color round trips, and valid rotations', () => {
    assert.equal(new Set(Object.values(pieceIds)).size, Object.keys(pieceDefinitions).length);
    assert.equal(pieceColor(0), null);
    for (const [name, definition] of Object.entries(pieceDefinitions)) {
        for (const color of ['white', 'black']) {
            const code = makePiece(name, color);
            assert.equal(pieceColor(code), color);
            assert.equal(pieceName(code), name);
            if (definition.rotatesTo) {
                const board = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, code]);
                const snapshot = structuredClone(board);
                const move = generate(board, 36).find(m => m.kind === 'rotate');
                assert.equal(move.piece, definition.rotatesTo);
                const rotated = applyMove(board, move);
                assert.equal(rotated[4 * 8 + 4], makePiece(definition.rotatesTo, color));
                const back = generate(rotated, 36).find(m => m.kind === 'rotate');
                assert.deepEqual(applyMove(rotated, back), board);
                assert.deepEqual(board, snapshot);
            }
        }
        for (const color of ['white', 'black']) {
            assert.ok(fs.existsSync(fileURLToPath(new URL(`../public/pieces/${color}-${definition.image}.svg`, import.meta.url))));
        }
    }
});


for (const color of ['white', 'black']) {
    test(`${color} promotion moves include all four choices and undo captures exactly`, () => {
        const enemy = color === 'white' ? 'black' : 'white';
        const row = color === 'white' ? 1 : 6;
        const finalRow = color === 'white' ? 0 : 7;
        const board = position([color === 'white' ? 7 : 0, 7, makePiece('king', color)],
            [finalRow, 7, makePiece('king', enemy)], [row, 2, makePiece('pawn', color)],
            [finalRow, 2, makePiece('rook', enemy)]);
        const before = board.slice();
        const moves = generate(board, row * 8 + 2);
        assert.equal(moves.length, 12); // Two quiet destinations and one capture, four choices each.
        for (const col of [1, 2, 3]) {
            const choices = moves.filter(move => move.to === finalRow * 8 + col);
            assert.deepEqual(choices.map(move => move.promotion), ['queen', 'rook', 'bishop', 'knight']);
            for (const move of choices) {
                const undo = saveUndoInformation(board, move);
                const originalMove = structuredClone(move);
                makeMove(board, move);
                assert.equal(board[move.to], makePiece(move.promotion, color));
                assert.equal(board[move.from], 0);
                unmakeMove(board, move, undo);
                assert.deepEqual(board, before);
                assert.deepEqual(move, originalMove);
            }
        }
        assert.throws(() => makeMove(board, { from: row * 8 + 2, to: finalRow * 8 + 1, kind: 'm' }), /promotion/);
        assert.deepEqual(board, before);
    });

    test(`${color} minimax looks past a poisoned capture and preserves the board`, () => {
        const original = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')],
            [7, 0, makePiece('rook', 'white')], [4, 0, makePiece('pawn', 'black')], [4, 1, makePiece('rook', 'black')]);
        const board = color === 'white' ? original : original.toReversed().map(piece => -piece || 0);
        const before = board.slice();
        const poisonedDestination = color === 'white' ? 32 : 31;
        assert.equal(Engine(board, color, 1).to, poisonedDestination);
        assert.notEqual(Engine(board, color, 2).to, poisonedDestination);
        assert.deepEqual(board, before);
    });

    test(`${color} minimax scores checkmate after promotion at the depth limit`, () => {
        const original = position([2, 1, makePiece('king', 'white')], [2, 3, makePiece('knight', 'white')],
            [1, 2, makePiece('pawn', 'white')], [0, 0, makePiece('king', 'black')]);
        const board = color === 'white' ? original : original.toReversed().map(piece => -piece || 0);
        const before = board.slice();
        const move = Engine(board, color, 1);
        assert.ok(move.promotion);
        assert.deepEqual(getGameStatus(applyMove(board, move), color === 'white' ? 'black' : 'white'), { kind: 'checkmate', winner: color });
        assert.deepEqual(board, before);
    });
}

test('minimax considers underpromotion to avoid stalemate', () => {
    const board = position([3, 1, makePiece('king', 'white')], [1, 0, makePiece('king', 'black')],
        [0, 1, makePiece('rook', 'white')], [1, 2, makePiece('pawn', 'white')]);
    const before = board.slice();
    const choices = generate(board, 10);
    const queen = choices.find(move => move.promotion === 'queen');
    assert.deepEqual(getGameStatus(applyMove(board, queen), 'black'), { kind: 'stalemate' });
    const move = Engine(board, 'white', 1);
    assert.equal(move.promotion, 'bishop');
    assert.notEqual(getGameStatus(applyMove(board, move), 'black').kind, 'stalemate');
    assert.deepEqual(board, before);
});

test('minimax returns null for finished positions and rejects invalid depths', () => {
    const mate = position([0, 0, makePiece('king', 'black')], [0, 2, makePiece('rook', 'white')],
        [1, 2, makePiece('rook', 'white')], [7, 7, makePiece('king', 'white')]);
    const stalemate = position([0, 0, makePiece('king', 'black')], [2, 1, makePiece('knight', 'white')], [7, 7, makePiece('king', 'white')]);
    assert.equal(Engine(mate, 'black'), null);
    assert.equal(Engine(stalemate, 'black'), null);
    for (const depth of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => Engine(mate, 'black', depth), RangeError);
});


test('search counters count leaves, edges, and cutoffs and reset between searches', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 7, makePiece('pawn', 'black')]);
    const stats = createSearchStats();
    const move = Engine(board, 'white', 2, stats, { positionalScale: 0 });
    assert.deepEqual(Engine(board, 'white', 2, undefined, { positionalScale: 0 }), move);
    assert.equal(stats.positionsVisited, 9);
    assert.equal(stats.movesExplored, 8);
    assert.equal(stats.positionsEvaluated, 5);
    assert.equal(stats.materialEvaluations, 5);
    assert.equal(stats.terminalPositions, 0);
    assert.equal(stats.cutoffs, 2);
    assert.equal(stats.movesSkipped, 4);
    assert.ok(stats.generatedMoves > stats.movesExplored);
    assert.ok(stats.elapsedMs >= 0);
    Engine(board, 'white', 1, stats, { positionalScale: 0 });
    assert.equal(stats.positionsVisited, 4);
    assert.equal(stats.positionsEvaluated, 3);
    assert.equal(stats.cutoffs, 0);
    assert.equal(stats.movesSkipped, 0);
});


test('benchmark FEN validation accepts presets and rejects unsafe custom inputs', () => {
    for (const preset of benchmarkPositions) assert.equal(parseBenchmarkFen(preset.fen).board.length, 64);
    assert.equal(parseBenchmarkFen('7k/8/8/8/8/8/8/K7 b').turn, 'black');
    for (const fen of [
        '8/8/8/8/8/8/8/8 w',
        '7k/8/8/8/8/8/8/K7 x',
        '7k/8/8/8/8/8/8/KP6 w',
        '8/8/8/8/8/8/1k6/K7 w',
        '4k3/8/8/8/8/8/4R3/K7 w',
        '7k/8/8/8/8/8/8/K7 w - - -1 1',
        '7k/8/8/8/8/8/8/K7 w - - 0 0',
    ]) assert.throws(() => parseBenchmarkFen(fen));
    assert.equal(parseBenchmarkFen('4k3/8/8/8/8/8/4R3/K7 b - - 0 1').turn, 'black');
});

test('plain minimax and alpha-beta agree while pruning reduces evaluations', () => {
    const board = parseFen('7k/7p/8/8/8/8/8/K7');
    const plain = createSearchStats(), pruned = createSearchStats();
    assert.deepEqual(Engine(board, 'white', 2, plain, { mode: 'minimax', positionalScale: 0 }), Engine(board, 'white', 2, pruned, { mode: 'alpha-beta', positionalScale: 0 }));
    assert.equal(plain.positionsEvaluated, 9);
    assert.equal(pruned.positionsEvaluated, 5);
    assert.equal(plain.cutoffs, 0);
    assert.ok(pruned.cutoffs > 0);
});

test('search deadline unwinds every move and retains partial statistics', () => {
    const board = parseFen(benchmarkPositions[0].fen), before = board.slice();
    const stats = createSearchStats();
    assert.throws(() => Engine(board, 'white', 8, stats, { mode: 'minimax', maxTimeMs: 0.000001 }), SearchTimeoutError);
    assert.deepEqual(board, before);
    assert.ok(stats.positionsVisited >= 1);
    assert.ok(stats.elapsedMs > 0);
});

test('benchmark runner emits generation measurements and complete comparisons', () => {
    const messages = [];
    runBenchmark({ fen: '7k/7p/8/8/8/8/8/K7 w - - 0 1', modes: ['minimax', 'alpha-beta'], maxDepth: 2, repetitions: 1, timeLimitMs: 1000, quiescence: false, positionalScale: 0 }, message => messages.push(message));
    assert.equal(messages[0].type, 'generation');
    assert.equal(messages[0].legalMoves, 3);
    assert.ok(messages[0].microseconds > 0);
    const results = messages.filter(message => message.type === 'result').map(message => message.result);
    assert.equal(results.length, 4);
    assert.ok(results.every(result => result.status === 'complete' && result.medianMs !== null));
    assert.equal(results.find(result => result.mode === 'minimax' && result.depth === 2).stats.positionsEvaluated, 9);
    assert.equal(results.find(result => result.mode === 'alpha-beta' && result.depth === 2).stats.positionsEvaluated, 5);
    assert.equal(messages.at(-1).type, 'done');
});


test('ordering ranks material magnitudes, promotions, jumps, and king attackers for both colors', () => {
    for (const color of ['white', 'black']) {
        const enemy = color === 'white' ? 'black' : 'white';
        const board = position([4, 4, makePiece('pawn', color)], [3, 4, makePiece('queen', enemy)]);
        const snapshot = board.slice();
        const capture = { from: 36, to: 28, kind: 'c' };
        const pawnCapture = movePriority(board, capture);
        board[36] = makePiece('queen', color);
        assert.ok(pawnCapture > movePriority(board, capture));
        board[36] = makePiece('king', color);
        assert.ok(pawnCapture > movePriority(board, capture));
        board[36] = snapshot[36];
        assert.equal(movePriority(board, { from: 36, to: 27, kind: 'm' }), 0);
        assert.equal(movePriority(board, { from: 36, to: 36, kind: 'rotate', piece: 'diagonalrook' }), 0);
        assert.deepEqual(board, snapshot);

        const bishopBoard = position([5, 2, makePiece('bishop', color)], [4, 3, makePiece('queen', enemy)]);
        assert.ok(movePriority(bishopBoard, { from: 42, to: 28, kind: 'ch' }) > 0);
        bishopBoard[35] = makePiece('queen', color);
        assert.equal(movePriority(bishopBoard, { from: 42, to: 28, kind: 'm' }), 0);

        const row = color === 'white' ? 1 : 6, final = color === 'white' ? 0 : 7;
        const pawnBoard = position([row, 2, makePiece('pawn', color)]);
        const base = { from: row * 8 + 2, to: final * 8 + 1, kind: 'm' };
        const queenPriority = movePriority(pawnBoard, { ...base, promotion: 'queen' });
        const knightPriority = movePriority(pawnBoard, { ...base, promotion: 'knight' });
        assert.ok(queenPriority > knightPriority && knightPriority > 0);
        pawnBoard[base.to] = makePiece('rook', enemy);
        assert.ok(movePriority(pawnBoard, { ...base, kind: 'c', promotion: 'queen' }) > queenPriority);
    }
    const white = position([4, 4, makePiece('pawn', 'white')], [3, 4, makePiece('queen', 'black')]);
    const black = white.map(piece => -piece || 0);
    assert.equal(movePriority(white, { from: 36, to: 28, kind: 'c' }), movePriority(black, { from: 36, to: 28, kind: 'c' }));
});

function referenceMinimax(board, turn, depth, ply = 0, castling = { white: false, black: false }) {
    const moves = board.flatMap((piece, square) => pieceColor(piece) === turn ? generate(board, square, castling) : []);
    if (!moves.length) return isKingSafe(board, turn) ? 0 : turn === 'white' ? -MATE_SCORE + ply : MATE_SCORE - ply;
    if (depth === 0) return evaluateBoard(board);
    const scores = moves.map(move => {
        const flags = { ...castling };
        return referenceMinimax(applyMove(board, move, flags), turn === 'white' ? 'black' : 'white', depth - 1, ply + 1, flags);
    });
    return turn === 'white' ? Math.max(...scores) : Math.min(...scores);
}

test('ordered alpha-beta agrees with copied-board minimax on presets for both sides', () => {
    for (const preset of benchmarkPositions) {
        const board = parseFen(preset.fen), before = board.slice();
        for (const turn of ['white', 'black']) {
            const expected = referenceMinimax(board, turn, 2);
            for (const mode of ['minimax', 'alpha-beta', 'alpha-beta-ordered']) {
                const move = Engine(board, turn, 2, undefined, { mode });
                const flags = { white: false, black: false };
                const actual = referenceMinimax(applyMove(board, move, flags), turn === 'white' ? 'black' : 'white', 1, 1, flags);
                assert.equal(actual, expected, `${preset.id}, ${turn}, ${mode}`);
                assert.deepEqual(board, before);
            }
        }
    }
});

test('ordering reduces explored positions in the seeded middlegame', () => {
    const board = parseFen(benchmarkPositions[0].fen), before = board.slice();
    const plainOrder = createSearchStats(), ordered = createSearchStats();
    const originalMove = Engine(board, 'white', 3, plainOrder, { mode: 'alpha-beta' });
    const orderedMove = Engine(board, 'white', 3, ordered, { mode: 'alpha-beta-ordered' });
    assert.equal(referenceMinimax(applyMove(board, originalMove), 'black', 2), referenceMinimax(applyMove(board, orderedMove), 'black', 2));
    assert.ok(ordered.positionsVisited < plainOrder.positionsVisited);
    assert.deepEqual(board, before);
});

test('benchmark runner supports the ordered mode', () => {
    const messages = [];
    runBenchmark({ fen: benchmarkPositions[6].fen, modes: ['alpha-beta-ordered'], maxDepth: 1, repetitions: 1, timeLimitMs: 1000, quiescence: false }, message => messages.push(message));
    const result = messages.find(message => message.type === 'result').result;
    assert.equal(result.mode, 'alpha-beta-ordered');
    assert.equal(result.status, 'complete');
    assert.ok(result.move.promotion);
});


for (const color of ['white', 'black']) {
    test(`${color} quiescence avoids a poisoned capture at the normal depth limit`, () => {
        const original = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')],
            [7, 0, makePiece('rook', 'white')], [4, 0, makePiece('pawn', 'black')], [4, 1, makePiece('rook', 'black')]);
        const board = color === 'white' ? original : original.toReversed().map(piece => -piece || 0);
        const before = board.slice(), stats = createSearchStats();
        const poison = color === 'white' ? 32 : 31;
        assert.equal(Engine(board, color, 1).to, poison);
        const move = engineSearch(board, color, 1, stats, { maxTimeMs: 3000, maxQuiescencePly: 8 });
        assert.notEqual(move.to, poison);
        assert.ok(stats.quiescenceNodes > 0);
        assert.ok(stats.quiescenceMoves > 0);
        assert.equal(stats.positionsVisited, stats.movesExplored + 1);
        assert.deepEqual(board, before);
    });

    test(`${color} quiescence searches quiet check escapes and then returns to tactical moves`, () => {
        const original = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 0, makePiece('rook', 'white')]);
        const board = color === 'white' ? original : original.toReversed().map(piece => -piece || 0);
        const before = board.slice(), stats = createSearchStats();
        const move = engineSearch(board, color, 1, stats, { mode: 'minimax', maxQuiescencePly: 1 });
        assert.ok(move);
        assert.ok(stats.quiescenceMoves > 0);
        assert.equal(stats.maxQuiescencePlyReached, 1);
        assert.deepEqual(board, before);
        // A spent capture budget still permits a forced evasion before static evaluation.
        const escaped = createSearchStats();
        assert.ok(engineSearch(board, color, 1, escaped, { mode: 'minimax', maxQuiescencePly: 0 }));
        assert.ok(escaped.quiescenceMoves > 0);
        assert.deepEqual(board, before);
        // With BOTH allowances exhausted, the checked leaf cannot be treated as stand pat.
        assert.throws(() => engineSearch(board, color, 1, stats, { mode: 'minimax', maxQuiescencePly: 0, maxCheckEvasionPly: 0 }), QuiescenceLimitError);
        assert.deepEqual(board, before);
        assert.ok(stats.quiescenceLimitHits > 0);
    });
}

test('a quiet quiescence position evaluates normally rather than becoming a false stalemate', () => {
    const board = parseFen('7k/7p/8/8/8/8/8/K7'), before = board.slice(), stats = createSearchStats();
    assert.ok(engineSearch(board, 'white', 1, stats));
    assert.equal(stats.quiescenceNodes, 3);
    assert.equal(stats.quiescenceMoves, 0);
    assert.equal(stats.terminalPositions, 0);
    assert.equal(stats.materialEvaluations, 3);
    assert.deepEqual(board, before);
});

test('the quiescence cap bounds capture continuations and records truncated tactical leaves', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')],
        [4, 2, makePiece('pawn', 'white')], [3, 2, makePiece('pawn', 'black')],
        [3, 3, makePiece('rook', 'black')], [2, 1, makePiece('bishop', 'white')]);
    const before = board.slice(), stats = createSearchStats();
    assert.ok(engineSearch(board, 'white', 1, stats, { mode: 'minimax', maxQuiescencePly: 1 }));
    assert.ok(stats.quiescenceMoves > 0);
    assert.ok(stats.quiescenceLimitHits > 0);
    assert.equal(stats.maxQuiescencePlyReached, 1);
    assert.deepEqual(board, before);
    for (const limit of [-1, 1.5, NaN, Infinity, 33]) {
        assert.throws(() => engineSearch(board, 'white', 1, undefined, { maxQuiescencePly: limit }), RangeError);
    }
});

test('benchmark distinguishes an unresolved-check extension limit from a time limit', () => {
    const messages = [];
    runBenchmark({ fen: '7k/R7/8/8/8/8/8/K7 w - - 0 1', modes: ['alpha-beta-ordered'], maxDepth: 2,
        repetitions: 1, timeLimitMs: 1000, quiescence: true, maxQuiescencePly: 0, maxCheckEvasionPly: 0 }, message => messages.push(message));
    const results = messages.filter(message => message.type === 'result').map(message => message.result);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'extension-limit');
    assert.equal(results[0].medianMs, null);
    assert.equal(results[0].move, null);
    assert.ok(results[0].stats.quiescenceLimitHits > 0);
    assert.equal(messages.at(-1).type, 'done');
});

const { searchBot, defaultBotSettings } = load('bot_search');

for (const turn of ['white', 'black']) {
    test(`playable bot completes iterative depths for ${turn} without changing the position`, () => {
        const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')],
            [6, 2, makePiece('pawn', 'white')], [1, 5, makePiece('pawn', 'black')]);
        const before = board.slice();
        const reports = [];
        const result = searchBot({ board, turn, settings: { ...defaultBotSettings, maxDepth: 2, quiescence: false } }, report => reports.push(report));
        assert.equal(result.completedDepth, 2);
        assert.equal(result.limit, null);
        assert.equal(result.fallback, false);
        assert.deepEqual(result.move, Engine(board, turn, 2));
        assert.ok(generate(board, result.move.from).some(move => JSON.stringify(move) === JSON.stringify(result.move)));
        assert.ok(result.stats.positionsVisited > 0);
        assert.ok(reports.length >= 4);
        for (let index = 1; index < reports.length; index++) assert.ok(reports[index].stats.positionsVisited >= reports[index - 1].stats.positionsVisited);
        assert.deepEqual(board, before);
    });
}

test('bot time budget retains a completed move and includes partial work in statistics', () => {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    const before = board.slice();
    const result = searchBot({ board, turn: 'white', settings: { ...defaultBotSettings, mode: 'minimax', maxDepth: 8, maxTimeMs: 100, quiescence: false } });
    assert.equal(result.limit, 'time');
    assert.ok(result.completedDepth >= 1 && result.completedDepth < 8);
    assert.equal(result.fallback, false);
    assert.ok(result.stats.elapsedMs >= 100 && result.stats.elapsedMs < 3000);
    assert.deepEqual(result.move, Engine(board, 'white', result.completedDepth, undefined, { mode: 'minimax' }));
    assert.deepEqual(board, before);
});

test('bot falls back to a legal move when the check-extension limit prevents depth one', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [6, 7, makePiece('rook', 'white')]);
    const result = searchBot({ board, turn: 'white', settings: { ...defaultBotSettings, maxQuiescencePly: 0, maxCheckEvasionPly: 0 } });
    assert.equal(result.limit, 'quiescence');
    assert.equal(result.completedDepth, 0);
    assert.equal(result.fallback, true);
    assert.ok(generate(board, result.move.from).some(move => JSON.stringify(move) === JSON.stringify(result.move)));
});

test('game accepts complete engine promotions and rotations, rejects illegal and stale replies', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 2, makePiece('pawn', 'white')]);
    const game = createGame(board);
    const move = generate(board, 10).find(move => move.promotion === 'knight');
    const promoted = gameReducer(game, { type: 'engine-move', move, expectedBoard: board, turn: 'white' });
    assert.equal(promoted.board[move.to], makePiece('knight', 'white'));
    assert.equal(promoted.pendingPromotion, null);
    assert.equal(promoted.turn, 'black');
    assert.equal(gameReducer(game, { type: 'engine-move', move, expectedBoard: board.slice(), turn: 'white' }), game);
    assert.equal(gameReducer(game, { type: 'engine-move', move, expectedBoard: board, turn: 'black' }), game);
    assert.equal(gameReducer(game, { type: 'engine-move', move: { from: 10, to: 3, kind: 'm' }, expectedBoard: board, turn: 'white' }), game);
    const rookBoard = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [5, 2, makePiece('rook', 'white')]);
    const rotation = generate(rookBoard, 42).find(move => move.kind === 'rotate');
    const rotated = gameReducer(createGame(rookBoard), { type: 'engine-move', move: rotation, expectedBoard: rookBoard, turn: 'white' });
    assert.equal(rotated.board[42], makePiece('diagonalrook', 'white'));
    assert.equal(rotated.turn, 'black');
});

test('endgame weight depends on defender non-king count and stays within zero to one', () => {
    assert.equal(endgameWeight(15), 0);
    assert.equal(endgameWeight(8), 0);
    assert.equal(endgameWeight(4), 0.5);
    assert.equal(endgameWeight(0), 1);
    assert.equal(endgameWeight(-1), 1);
    assert.equal(endgameWeight(30), 0);
});

test('king-driving evaluation rewards approach and edges with a tunable multiplier', () => {
    assert.ok(ForceKingToCheckmateEval(49, 7, 1) > ForceKingToCheckmateEval(56, 7, 1));
    // Both targets are seven steps away, isolating the edge bonus from approach.
    assert.ok(ForceKingToCheckmateEval(56, 63, 1) > ForceKingToCheckmateEval(56, 27, 1));
    assert.equal(ForceKingToCheckmateEval(56, 7, 0), 0);
    assert.equal(ForceKingToCheckmateEval(56, 7, 1, 20), 2 * ForceKingToCheckmateEval(56, 7, 1, 10));
});

test('endgame evaluation keeps White-positive signs, ignores attacker count, and preserves material at scale zero', () => {
    const board = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 3, makePiece('rook', 'white')]);
    assert.ok(evaluateBoard(board) > 500);
    const extraAttackers = board.slice();
    for (let square = 8; square < 24; square++) extraAttackers[square] = makePiece('rook', 'white');
    const extraMaterial = extraAttackers.reduce((sum, piece) => sum + pieceValue(piece), 0);
    assert.ok(Math.abs((evaluateBoard(extraAttackers, 5, 0) - extraMaterial) - (evaluateBoard(board, 5, 0) - 500)) < 1e-10);
    assert.equal(evaluateBoard(board, 0, 0), 500);
    assert.ok(evaluateBoard(board, 20, 0) > evaluateBoard(board, 10, 0));
    assert.equal(evaluateBoard(board.map(piece => -piece || 0), 5, 0), -evaluateBoard(board, 5, 0));
    const pawnOnly = board.slice(); pawnOnly[35] = makePiece('pawn', 'white');
    assert.equal(evaluateBoard(pawnOnly, 5, 0), 100);
    const equal = board.slice(); equal[28] = makePiece('rook', 'black');
    assert.equal(evaluateBoard(equal, 5, 0), 0);
});

for (const color of ['white', 'black']) {
    test(`${color} engine uses king-driving bonus in normal and quiescence evaluations`, () => {
        const white = position([7, 0, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 3, makePiece('rook', 'white')]);
        const board = color === 'white' ? white : white.slice().reverse().map(piece => -piece || 0);
        const before = board.slice();
        for (const quiescence of [false, true]) {
            const move = engineSearch(board, color, 1, undefined, { quiescence });
            assert.equal(move.from, color === 'white' ? 56 : 7);
            assert.equal(move.to, color === 'white' ? 49 : 14);
            assert.deepEqual(board, before);
        }
        for (const checkmateEvalScale of [-1, 101, NaN, Infinity]) assert.throws(() => engineSearch(board, color, 1, undefined, { checkmateEvalScale }), RangeError);
    });
    test(`${color} chooses immediate checkmate over a longer forced mate or king-driving bonus`, () => {
        const white = position([0, 0, makePiece('king', 'black')], [0, 2, makePiece('rook', 'white')], [2, 2, makePiece('rook', 'white')], [7, 7, makePiece('king', 'white')]);
        const board = color === 'white' ? white : white.slice().reverse().map(piece => -piece || 0);
        const move = engineSearch(board, color, 3, undefined, { quiescence: false, checkmateEvalScale: 100 });
        assert.deepEqual(getGameStatus(applyMove(board, move), color === 'white' ? 'black' : 'white'), { kind: 'checkmate', winner: color });
    });
}

for (const color of ['white', 'black']) {
    const home = color === 'white' ? 60 : 4;
    const enemy = color === 'white' ? 'black' : 'white';
    const row = color === 'white' ? 7 : 0;
    function castleBoard() {
        return position([row, 4, makePiece('king', color)], [row, 0, makePiece('rook', color)],
            [row, 7, makePiece('rook', color)], [color === 'white' ? 0 : 7, 4, makePiece('king', enemy)]);
    }
    test(`${color} generates both castles with correct squares without mutating flags or board`, () => {
        const board = castleBoard(), before = board.slice(), flags = { white: false, black: false };
        const castles = generate(board, home, flags).filter(move => move.kind === 'castle');
        assert.deepEqual(castles, [
            { from: home, to: home + 2, kind: 'castle', rookFrom: home + 3, rookTo: home + 1 },
            { from: home, to: home - 2, kind: 'castle', rookFrom: home - 4, rookTo: home - 1 },
        ]);
        assert.deepEqual(board, before);
        assert.deepEqual(flags, { white: false, black: false });
        assert.equal(movePriority(board, castles[0]), 0);
    });
    test(`${color} checks castle wings independently and requires its own unrotated rook`, () => {
        const board = castleBoard(); board[home + 1] = makePiece('knight', color);
        assert.deepEqual(generate(board, home).filter(move => move.kind === 'castle').map(move => move.to), [home - 2]);
        board[home + 1] = 0; board[home - 3] = makePiece('knight', color);
        assert.deepEqual(generate(board, home).filter(move => move.kind === 'castle').map(move => move.to), [home + 2]);
        board[home - 3] = 0; board[home + 3] = makePiece('diagonalrook', color); board[home - 4] = makePiece('rook', enemy);
        assert.equal(generate(board, home).filter(move => move.kind === 'castle').length, 0);
    });
    test(`${color} may castle across an attack but cannot start or finish in check`, () => {
        const board = castleBoard();
        const attackRow = color === 'white' ? 3 : 4;
        board[attackRow * 8 + 5] = makePiece('rook', enemy);
        assert.equal(isKingSafe(board, color), true);
        assert.ok(generate(board, home).some(move => move.kind === 'castle' && move.to === home + 2));
        board[attackRow * 8 + 5] = 0; board[attackRow * 8 + 6] = makePiece('rook', enemy);
        const before = board.slice();
        assert.equal(generate(board, home).some(move => move.kind === 'castle' && move.to === home + 2), false);
        assert.deepEqual(board, before);
        board[attackRow * 8 + 6] = 0; board[attackRow * 8 + 4] = makePiece('rook', enemy);
        assert.equal(isKingSafe(board, color), false);
        assert.equal(generate(board, home).some(move => move.kind === 'castle'), false);
    });
    test(`${color} earlier king and rook movements do not consume castling`, () => {
        const board = castleBoard(), flags = { white: false, black: false };
        const step = color === 'white' ? -8 : 8;
        for (const move of [
            { from: home, to: home + step, kind: 'm' }, { from: home + step, to: home, kind: 'm' },
            { from: home + 3, to: home + 3 + step, kind: 'm' }, { from: home + 3 + step, to: home + 3, kind: 'm' },
        ]) makeMove(board, move, flags);
        assert.equal(flags[color], false);
        assert.equal(generate(board, home, flags).filter(move => move.kind === 'castle').length, 2);
        const movedKing = board.slice(); movedKing[home + step] = movedKing[home]; movedKing[home] = 0;
        assert.equal(generate(movedKing, home + step, flags).some(move => move.kind === 'castle'), false);
    });
    test(`${color} castle updates the game once, preserves the previous state, and rejects reused permission`, () => {
        const board = castleBoard(), game = createGame(board, color);
        const next = click(click(game, row, 4), row, 6);
        assert.equal(next.board[home], 0);
        assert.equal(next.board[home + 3], 0);
        assert.equal(next.board[home + 2], makePiece('king', color));
        assert.equal(next.board[home + 1], makePiece('rook', color));
        assert.equal(next.castling[color], true);
        assert.equal(next.castling[enemy], false);
        assert.equal(game.castling[color], false);
        assert.equal(next.turn, enemy);
        assert.equal(next.lastMove.kind, 'castle');
        const reused = createGame(castleBoard(), color, next.castling);
        assert.equal(generate(reused.board, home, reused.castling).some(move => move.kind === 'castle'), false);
        const restarted = gameReducer(next, { type: 'restart', board: castleBoard() });
        assert.deepEqual(restarted.castling, { white: false, black: false });
        const move = generate(board, home, game.castling).find(move => move.kind === 'castle');
        const accepted = gameReducer(game, { type: 'engine-move', expectedBoard: board, turn: color, move });
        assert.equal(accepted.castling[color], true);
        assert.equal(gameReducer(game, { type: 'engine-move', expectedBoard: board, turn: color, move: { ...move, rookFrom: home } }), game);
    });
}

test('nested castles restore both rooks, kings, and independent once-per-color flags', () => {
    const board = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    const before = board.slice(), flags = { white: false, black: false };
    const white = generate(board, 60, flags).find(move => move.kind === 'castle' && move.to === 62);
    const whiteUndo = saveUndoInformation(board, white, flags);
    makeMove(board, white, flags);
    assert.deepEqual(flags, { white: true, black: false });
    const afterWhite = board.slice();
    const black = generate(board, 4, flags).find(move => move.kind === 'castle' && move.to === 6);
    assert.ok(black);
    const blackUndo = saveUndoInformation(board, black, flags);
    makeMove(board, black, flags);
    assert.deepEqual(flags, { white: true, black: true });
    unmakeMove(board, black, blackUndo, flags);
    assert.deepEqual(flags, { white: true, black: false });
    assert.deepEqual(board, afterWhite);
    unmakeMove(board, white, whiteUndo, flags);
    assert.deepEqual(flags, { white: false, black: false });
    assert.deepEqual(board, before);
});

test('search and the bot worker request respect used castling without mutating the supplied position', () => {
    const board = parseFen('4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
    const before = board.slice();
    for (const used of [false, true]) {
        const castling = { white: used, black: false };
        const expected = board.flatMap((piece, square) => pieceColor(piece) === 'white' ? generate(board, square, castling) : []);
        const bestScore = referenceMinimax(board, 'white', 2, 0, castling);
        for (const mode of ['minimax', 'alpha-beta', 'alpha-beta-ordered']) {
            const stats = createSearchStats();
            const move = engineSearch(board, 'white', 2, stats, { mode, quiescence: false, castling });
            assert.ok(expected.some(candidate => JSON.stringify(candidate) === JSON.stringify(move)));
            const childFlags = { ...castling };
            assert.equal(referenceMinimax(applyMove(board, move, childFlags), 'black', 1, 1, childFlags), bestScore);
            assert.deepEqual(board, before);
            assert.deepEqual(castling, { white: used, black: false });
        }
        const result = searchBot({ board, turn: 'white', castling, settings: { ...defaultBotSettings, maxDepth: 1, quiescence: false } });
        assert.equal(result.legalMoves, expected.length);
        assert.deepEqual(castling, { white: used, black: false });
        assert.deepEqual(board, before);
        assert.throws(() => engineSearch(board, 'white', 8, undefined, { castling, maxTimeMs: 0.000001 }), SearchTimeoutError);
        assert.deepEqual(board, before);
        assert.deepEqual(castling, { white: used, black: false });
    }
});

const { POSITION_BONUS_LIMIT, boundedPositionBonus, openingWeight, STARTING_PHASE_MATERIAL,
    createPieceSquareTables, defaultPieceSquareTables } = load('../utils/positional_eval');

function mirrorColors(board) {
    const mirrored = Array(64).fill(0);
    for (let square = 0; square < 64; square++) mirrored[(7 - Math.floor(square / 8)) * 8 + square % 8] = -board[square] || 0;
    return mirrored;
}

test('piece-square tables reward modest development, pawn advancement, and early king shelter', () => {
    const t = defaultPieceSquareTables;
    assert.ok(t[pieceIds.knight].opening[42] > t[pieceIds.knight].opening[57]);
    assert.ok(t[pieceIds.bishop].opening[40] > t[pieceIds.bishop].opening[58]);
    assert.ok(t[pieceIds.pawn].endgame[10] > t[pieceIds.pawn].endgame[18]);
    assert.ok(t[pieceIds.king].opening[62] > t[pieceIds.king].opening[60]);
    assert.ok(t[pieceIds.king].endgame[35] > t[pieceIds.king].endgame[60]);
    assert.ok(t[pieceIds.queen].opening[59] > t[pieceIds.queen].opening[35]);
    for (const table of Object.values(t)) {
        assert.equal(table.opening.length, 64);
        assert.equal(table.endgame.length, 64);
        assert.ok([...table.opening, ...table.endgame].every(value => Math.abs(value) < 16));
    }
    const initial = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    assert.equal(evaluateBoard(initial), 0);
    const developed = initial.slice(); developed[40] = developed[58]; developed[58] = 0;
    assert.ok(evaluateBoard(developed) > evaluateBoard(initial));
});

test('opening phase uses both armies and ignores rook orientation', () => {
    assert.equal(openingWeight(STARTING_PHASE_MATERIAL), 1);
    assert.equal(openingWeight(STARTING_PHASE_MATERIAL / 2), 0.5);
    assert.equal(openingWeight(0), 0);
    assert.equal(openingWeight(STARTING_PHASE_MATERIAL * 2), 1);
    for (const seed of [0, 17, 500]) {
        const tables = createPieceSquareTables(seed);
        assert.equal(tables[pieceIds.rook], tables[pieceIds.diagonalrook]);
        const board = parseFen('4k3/8/8/8/3R4/8/8/4K3 w - - 0 1');
        const rotated = board.slice(); rotated[35] = makePiece('diagonalrook', 'white');
        assert.equal(evaluateBoard(board, 5, 1, tables), evaluateBoard(rotated, 5, 1, tables));
    }
});

test('combined positional and king-driving preferences cannot outweigh one pawn of material', () => {
    assert.equal(POSITION_BONUS_LIMIT, 40);
    assert.ok(boundedPositionBonus(100000) < 40);
    assert.ok(boundedPositionBonus(-100000) > -40);
    assert.ok(boundedPositionBonus(101) > boundedPositionBonus(100));
    const codes = [1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6, 0];
    for (let sample = 0; sample < 100; sample++) {
        const board = Array.from({ length: 64 }, (_, square) => codes[(square * 7 + sample * 3) % codes.length]);
        board[60] = makePiece('king', 'white'); board[4] = makePiece('king', 'black'); board[32] = 0;
        const richer = board.slice(); richer[32] = makePiece('pawn', 'white');
        const tables = createPieceSquareTables(sample);
        const material = board.reduce((sum, piece) => sum + pieceValue(piece), 0);
        const score = evaluateBoard(board, 100, 2, tables);
        assert.ok(Math.abs(score - material) < 40);
        assert.ok(evaluateBoard(richer, 100, 2, tables) > score);
    }
});

test('opening variation is stable, color-symmetric, tiny, and absent from endgame tables', () => {
    const first = createPieceSquareTables(42), again = createPieceSquareTables(42), other = createPieceSquareTables(43);
    assert.deepEqual(first, again);
    assert.notDeepEqual(first, other);
    for (const id of Object.keys(first)) {
        assert.deepEqual(first[id].endgame, defaultPieceSquareTables[id].endgame);
        for (let square = 0; square < 64; square++) assert.ok(Math.abs(first[id].opening[square] - defaultPieceSquareTables[id].opening[square]) <= 0.25);
    }
    const board = parseFen(benchmarkPositions[0].fen);
    assert.equal(evaluateBoard(mirrorColors(board), 5, 1, first), -evaluateBoard(board, 5, 1, first));
    const initial = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    assert.ok(Math.abs(evaluateBoard(initial, 5, 1, first)) < 1e-10);
});

test('seeded bot searches match the engine and keep material-only comparison available', () => {
    const board = parseFen('4k3/1p6/8/8/3N4/8/2P5/4K3 w - - 0 1');
    const before = board.slice();
    const settings = { ...defaultBotSettings, maxDepth: 2, quiescence: false };
    const result = searchBot({ board, turn: 'white', settings, evaluationSeed: 42 });
    const expected = engineSearch(board, 'white', 2, undefined, { quiescence: false, evaluationSeed: 42 });
    assert.deepEqual(result.move, expected);
    assert.deepEqual(engineSearch(board, 'white', 2, undefined, { quiescence: false, evaluationSeed: 42 }), expected);
    assert.deepEqual(board, before);
    assert.equal(evaluateBoard(board, 0, 0), board.reduce((sum, piece) => sum + pieceValue(piece), 0));
    for (const positionalScale of [-1, NaN, Infinity, 3]) assert.throws(() => engineSearch(board, 'white', 1, undefined, { positionalScale }), RangeError);
    for (const evaluationSeed of [-1, NaN, 1.5, 0x100000000]) assert.throws(() => engineSearch(board, 'white', 1, undefined, { evaluationSeed }), RangeError);
});

test('opening development beats a free rook-form switch for both colors and multiple game seeds', () => {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    const before = board.slice();
    for (const turn of ['white', 'black']) for (const evaluationSeed of [0, 42, 43, 1234]) {
        const move = engineSearch(board, turn, 2, undefined, { evaluationSeed });
        assert.notEqual(move.kind, 'rotate', `${turn}, seed ${evaluationSeed}`);
        assert.deepEqual(board, before);
    }
});

test('standard castling rights are lost on king moves, rook moves, and home-rook captures, and undo restores them', () => {
    for (const sign of [1, -1]) {
        const color = sign === 1 ? 'white' : 'black';
        const home = sign === 1 ? 60 : 4;
        for (const move of [
            { from: home, to: home - sign * 8, kind: 'm' },
            { from: home + 3, to: home + 3 - sign * 8, kind: 'm' },
            { from: home - 4, to: home - 4 - sign * 8, kind: 'm' },
        ]) {
            const board = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
            const flags = createCastlingState(), standard = createStandardState();
            const before = board.slice(), original = cloneStandardState(standard);
            const undo = saveUndoInformation(board, move, flags, standard);
            makeMove(board, move, flags, standard);
            assert.equal(standard.castlingRights[color][move.from === home - 4 ? 'queenSide' : 'kingSide'], false);
            if (move.from === home) assert.equal(standard.castlingRights[color].queenSide, false);
            const back = { from: move.to, to: move.from, kind: 'm' };
            const backUndo = saveUndoInformation(board, back, flags, standard);
            makeMove(board, back, flags, standard);
            assert.ok(!generateNormal(board, home, flags, standard).some(m => m.kind === 'castle' &&
                (move.from === home || m.rookFrom === move.from)));
            unmakeMove(board, back, backUndo, flags, standard);
            unmakeMove(board, move, undo, flags, standard);
            assert.deepEqual(board, before);
            assert.deepEqual(standard, original);
        }
    }
    const board = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const standard = createStandardState();
    makeMove(board, { from: 56, to: 0, kind: 'c' }, createCastlingState(), standard);
    assert.equal(standard.castlingRights.white.queenSide, false);
    assert.equal(standard.castlingRights.black.queenSide, false);
    assert.equal(standard.castlingRights.black.kingSide, true);
});

test('standard castles test origin, crossing, and destination attacks while Chaos keeps its transit rule', () => {
    for (const sign of [1, -1]) {
        const color = sign === 1 ? 'white' : 'black';
        const home = sign === 1 ? 60 : 4;
        const board = Array(64).fill(0);
        board[home] = 7 * sign;
        board[home + 3] = 4 * sign;
        board[sign === 1 ? 0 : 56] = -7 * sign;
        const flags = createCastlingState(), standard = createStandardState();
        const castles = () => generateNormal(board, home, flags, standard).filter(m => m.kind === 'castle');
        assert.equal(castles().length, 1);
        for (const file of [4, 5, 6]) {
            const attacker = (sign === 1 ? 0 : 56) + file;
            board[attacker] = -4 * sign;
            assert.equal(castles().length, 0);
            if (file === 5) assert.ok(generate(board, home, flags).some(m => m.kind === 'castle'));
            board[attacker] = 0;
        }
        const before = board.slice(), original = cloneStandardState(standard);
        const move = castles()[0], undo = saveUndoInformation(board, move, flags, standard);
        makeMove(board, move, flags, standard);
        assert.equal(board[home + 2], 7 * sign);
        assert.equal(board[home + 1], 4 * sign);
        assert.equal(standard.castlingRights[color].kingSide, false);
        assert.equal(standard.castlingRights[color].queenSide, false);
        unmakeMove(board, move, undo, flags, standard);
        assert.deepEqual(board, before);
        assert.deepEqual(standard, original);
        assert.equal(flags[color], false);
    }
});

test('en passant lasts one reply, captures the passed pawn, and restores board and state on undo', () => {
    for (const sign of [1, -1]) {
        const board = parseFen(sign === 1 ? '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1' : '4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1');
        const from = sign === 1 ? 11 : 51, to = sign === 1 ? 27 : 35;
        const capturer = sign === 1 ? 28 : 36;
        const flags = createCastlingState(), standard = createStandardState();
        makeMove(board, { from, to, kind: 'm' }, flags, standard);
        assert.equal(standard.enPassantTarget, (from + to) / 2);
        const before = board.slice(), original = cloneStandardState(standard);
        const move = generateNormal(board, capturer, flags, standard).find(m => m.kind === 'en-passant');
        assert.ok(move);
        assert.equal(movePriority(board, move), 900);
        const undo = saveUndoInformation(board, move, flags, standard);
        makeMove(board, move, flags, standard);
        assert.equal(board[to], 0);
        assert.equal(board[move.to], sign);
        assert.equal(standard.enPassantTarget, null);
        unmakeMove(board, move, undo, flags, standard);
        assert.deepEqual(board, before);
        assert.deepEqual(standard, original);
        const king = sign === 1 ? 60 : 4;
        makeMove(board, { from: king, to: king + (sign === 1 ? -1 : 1), kind: 'm' }, flags, standard);
        assert.equal(standard.enPassantTarget, null);
        assert.ok(!generateNormal(board, capturer, flags, standard).some(m => m.kind === 'en-passant'));
        assert.ok(!generate(board, capturer, flags).some(m => m.kind === 'en-passant'));
    }
});

test('en passant cannot uncover a rook attack on its own king but can remove a checking pawn', () => {
    const flags = createCastlingState(), standard = createStandardState();
    standard.enPassantTarget = 22; // g6
    const pinned = parseFen('k7/8/8/r4PpK/8/8/8/8 w - g6 0 1');
    assert.ok(!generateNormal(pinned, 29, flags, standard).some(m => m.kind === 'en-passant'));
    standard.enPassantTarget = 19; // d6
    const checked = parseFen('k7/8/8/3pP3/4K3/8/8/8 w - d6 0 1');
    assert.equal(normalKingSafe(checked, 'white'), false);
    assert.ok(generateNormal(checked, 28, flags, standard).some(m => m.kind === 'en-passant'));
});

test('standard opening perft matches 20, 400, 8902, and 197281 while restoring every search state', () => {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const flags = createCastlingState(), standard = createStandardState();
    const before = board.slice(), original = cloneStandardState(standard);
    function perft(turn, depth) {
        if (depth === 0) return 1;
        let nodes = 0;
        for (let from = 0; from < 64; from++) if (pieceColor(board[from]) === turn) {
            for (const move of generateNormal(board, from, flags, standard)) {
                const undo = saveUndoInformation(board, move, flags, standard);
                makeMove(board, move, flags, standard);
                try { nodes += perft(turn === 'white' ? 'black' : 'white', depth - 1); }
                finally { unmakeMove(board, move, undo, flags, standard); }
            }
        }
        return nodes;
    }
    for (const [depth, expected] of [[1, 20], [2, 400], [3, 8902], [4, 197281]]) assert.equal(perft('white', depth), expected);
    assert.deepEqual(board, before);
    assert.deepEqual(standard, original);
});

test('normal game reducer handles en passant, Fool\'s Mate, and restart without changing Chaos defaults', () => {
    const start = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const moveGame = (game, from, to) => {
        const selected = gameReducer(game, { type: 'click', square: [Math.floor(from / 8), from % 8] });
        const next = gameReducer(selected, { type: 'click', square: [Math.floor(to / 8), to % 8] });
        assert.notEqual(next.board, game.board);
        return next;
    };
    let game = createGame(start, 'white', undefined, 'normal');
    for (const [from, to] of [[53, 45], [12, 28], [54, 38], [3, 39]]) game = moveGame(game, from, to);
    assert.deepEqual(game.status, { kind: 'checkmate', winner: 'black' });
    game = gameReducer(game, { type: 'restart', board: start });
    assert.equal(game.ruleset, 'normal');
    assert.deepEqual(game.standard, createStandardState());
    for (const [from, to] of [[52, 36], [8, 16], [36, 28], [11, 27], [28, 19]]) game = moveGame(game, from, to);
    assert.equal(game.lastMove.kind, 'en-passant');
    assert.equal(game.board[27], 0);
    assert.equal(game.board[19], 1);
    assert.equal(game.standard.enPassantTarget, null);
    assert.equal(createGame(start).standard, undefined);
    assert.equal(createGame(start).ruleset, 'chaos');
});

test('normal bot searches and Zobrist keys preserve and distinguish special-move state', () => {
    const { zobrist_hash } = load('../utils/hash');
    const board = parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const standard = createStandardState(), flags = createCastlingState();
    standard.enPassantTarget = 19;
    const original = cloneStandardState(standard), before = board.slice();
    const hash = () => zobrist_hash(board, false, false, 'white', standard);
    const withEp = hash();
    assert.notEqual(withEp, zobrist_hash(board, false, false, 'white'));
    standard.enPassantTarget = null;
    assert.notEqual(hash(), withEp);
    standard.enPassantTarget = 19;
    const keys = new Set([hash()]);
    for (const color of ['white', 'black']) for (const side of ['kingSide', 'queenSide']) {
        standard.castlingRights[color][side] = false;
        keys.add(hash());
        standard.castlingRights[color][side] = true;
    }
    assert.equal(keys.size, 5);
    const result = searchBot({ board, turn: 'white', castling: flags, standard, settings: { ...defaultBotSettings, maxDepth: 2, maxTimeMs: 1000 } });
    assert.equal(result.move.kind, 'en-passant');
    assert.deepEqual(board, before);
    assert.deepEqual(standard, original);
    const game = createGame(board, 'white', flags, 'normal', standard);
    const accepted = gameReducer(game, { type: 'engine-move', move: result.move, expectedBoard: board, turn: 'white' });
    assert.equal(accepted.board[27], 0);
    assert.equal(accepted.board[19], 1);
    const forged = { ...result.move, capturedSquare: 0 };
    assert.equal(gameReducer(game, { type: 'engine-move', move: forged, expectedBoard: board, turn: 'white' }), game);
});

test('standard special-move perft matches castling and en passant reference positions', () => {
    for (const [fen, counts] of [
        ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
        ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    ]) {
        const board = parseFen(fen), before = board.slice();
        const standard = createStandardState(), flags = createCastlingState();
        if (fen.split(' ')[2] === '-') for (const color of ['white', 'black']) standard.castlingRights[color] = { kingSide: false, queenSide: false };
        const original = cloneStandardState(standard);
        function perft(turn, depth) {
            if (depth === 0) return 1;
            let count = 0;
            for (let from = 0; from < 64; from++) if (pieceColor(board[from]) === turn) {
                for (const move of generateNormal(board, from, flags, standard)) {
                    const undo = saveUndoInformation(board, move, flags, standard);
                    makeMove(board, move, flags, standard);
                    try { count += perft(turn === 'white' ? 'black' : 'white', depth - 1); }
                    finally { unmakeMove(board, move, undo, flags, standard); }
                }
            }
            return count;
        }
        counts.forEach((count, i) => assert.equal(perft('white', i + 1), count));
        assert.deepEqual(board, before);
        assert.deepEqual(standard, original);
    }
});

test('normal material and move ordering use standard values while Chaos stays unchanged', () => {
    for (const [name, value] of [['pawn', 100], ['knight', 320], ['bishop', 330], ['rook', 500], ['queen', 900], ['king', 0]]) {
        assert.equal(pieceValue(makePiece(name, 'white'), 'normal'), value);
        assert.equal(pieceValue(makePiece(name, 'black'), 'normal'), value ? -value : 0);
    }
    assert.equal(pieceValue(pieceIds.knight), 400);
    assert.equal(pieceValue(pieceIds.bishop), 200);
    const board = parseFen('7k/8/3b4/8/3Q1n2/8/8/K7 w - - 0 1');
    const options = { positionalScale: 0, checkmateEvalScale: 0, quiescence: false };
    assert.equal(Engine(board, 'white', 1, undefined, options).to, 37);
    assert.equal(Engine(board, 'white', 1, undefined, { ...options, standard: createStandardState() }).to, 19);
    assert.ok(movePriority(board, { from: 35, to: 19, kind: 'c' }, 'normal') > movePriority(board, { from: 35, to: 37, kind: 'c' }, 'normal'));
});

test('insufficient material differs between Normal and Chaos and respects bishop square colors', () => {
    const { hasInsufficientMaterial } = load('draw_rules');
    const cases = [
        ['7k/8/8/8/8/8/8/K7', true, true],
        ['7k/8/8/8/8/8/8/KB6', true, true],
        ['7k/8/8/8/8/8/8/KN6', true, false],
        ['6bk/8/8/8/8/8/8/KB6', true, true],
        ['5b1k/8/8/8/8/8/8/KB6', false, false],
        ['7k/8/8/8/8/8/8/KNN5', false, false],
        ['6nk/8/8/8/8/8/8/KN6', false, false],
        ['7k/8/8/8/8/8/P7/K7', false, false],
        ['7k/8/8/8/8/8/8/KR6', false, false],
    ];
    for (const [fen, normal, chaos] of cases) {
        const board = parseFen(fen);
        assert.equal(hasInsufficientMaterial(board, 'normal'), normal, fen);
        assert.equal(hasInsufficientMaterial(board, 'chaos'), chaos, fen);
    }
    // This is mate in Chaos, but K+N vs K is a dead position in Normal.
    const mate = position([0, 2, 7], [0, 0, -7], [0, 1, 2]);
    assert.deepEqual(getGameStatus(mate, 'black'), { kind: 'checkmate', winner: 'white' });
    assert.deepEqual(getGameStatus(mate, 'black', undefined, createStandardState()), { kind: 'draw', reason: 'insufficient-material' });
});

test('automatic 75-move draw requires 150 plies and ends both rule variants', () => {
    for (const ruleset of ['normal', 'chaos']) {
        let game = createGame(parseFen('6rk/8/8/8/8/8/8/KR6'), 'white', undefined, ruleset);
        const cycle = [[57, 49], [6, 14], [49, 57], [14, 6]];
        for (let ply = 0; ply < 150; ply++) {
            const [from, to] = cycle[ply % 4];
            const move = { from, to, kind: 'm' };
            game = gameReducer(game, { type: 'engine-move', move, expectedBoard: game.board, turn: game.turn });
            assert.equal(game.halfmoveClock, ply + 1);
            if (ply < 149) assert.equal(game.status.kind, 'playing');
        }
        assert.deepEqual(game.status, { kind: 'draw', reason: 'seventy-five-moves' });
        assert.equal(gameResultScore(game.status), 0);
        assert.equal(gameReducer(game, { type: 'click', square: [7, 1] }), game);
    }
});

test('pawn moves, promotions, all captures reset the draw clock; castling and rotation do not', () => {
    const { nextHalfmoveClock } = load('draw_rules');
    const board = Array(64).fill(0);
    board[52] = 1; board[28] = 1; board[8] = 1; board[42] = 3; board[56] = 4; board[60] = 7;
    for (const move of [
        { from: 52, to: 36, kind: 'm' },
        { from: 8, to: 0, kind: 'm', promotion: 'queen' },
        { from: 42, to: 28, kind: 'ch' },
        { from: 56, to: 48, kind: 'c' },
        { from: 28, to: 19, kind: 'en-passant', capturedSquare: 27 },
    ]) assert.equal(nextHalfmoveClock(board, move, 149), 0);
    assert.equal(nextHalfmoveClock(board, { from: 56, to: 48, kind: 'm' }, 149), 150);
    assert.equal(nextHalfmoveClock(board, { from: 56, to: 56, kind: 'rotate', piece: 'diagonalrook' }, 149), 150);
    assert.equal(nextHalfmoveClock(board, { from: 60, to: 62, kind: 'castle', rookFrom: 63, rookTo: 61 }, 149), 150);
    const game = createGame(parseFen('6rk/8/8/8/8/8/P7/KR6'), 'white', undefined, 'normal', createStandardState(), 149);
    const moved = gameReducer(game, { type: 'engine-move', move: { from: 48, to: 40, kind: 'm' }, expectedBoard: game.board, turn: 'white' });
    assert.equal(moved.halfmoveClock, 0);
    assert.equal(moved.status.kind, 'playing');
});

test('checkmate takes precedence over the 75-move draw on the final ply', () => {
    const game = createGame(parseFen('7k/8/5KQ1/8/8/8/8/8'), 'white', undefined, 'normal', createStandardState(), 149);
    const next = gameReducer(game, { type: 'engine-move', move: { from: 22, to: 14, kind: 'm' }, expectedBoard: game.board, turn: 'white' });
    assert.equal(next.halfmoveClock, 150);
    assert.deepEqual(next.status, { kind: 'checkmate', winner: 'white' });
    assert.deepEqual(Engine(game.board, 'white', 1, undefined, { standard: game.standard, halfmoveClock: 149 }), { from: 22, to: 14, kind: 'm' });
});

test('search stops at automatic draws and the hash distinguishes halfmove clocks', () => {
    const { zobrist_hash } = load('../utils/hash');
    const board = parseFen('6rk/8/8/8/8/8/8/KR6');
    const standard = createStandardState();
    const stats = createSearchStats();
    assert.equal(Engine(board, 'white', 2, stats, { standard, halfmoveClock: 150 }), null);
    assert.equal(stats.terminalPositions, 1);
    assert.equal(stats.materialEvaluations, 0);
    assert.notEqual(zobrist_hash(board, false, false, 'white', standard, 0), zobrist_hash(board, false, false, 'white', standard, 149));
    assert.equal(searchBot({ board, turn: 'white', standard, halfmoveClock: 150, settings: defaultBotSettings }).move, null);
    const kings = parseFen('7k/8/8/8/8/8/8/K7');
    assert.equal(Engine(kings, 'white', 2), null);
    assert.equal(searchBot({ board: kings, turn: 'white', settings: defaultBotSettings }).move, null);
});

test('resignation and local draw agreements end games and ignore stale engine results', () => {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    const initial = createGame(board);
    const offered = gameReducer(initial, { type: 'offer-draw', color: 'white' });
    assert.equal(gameReducer(offered, { type: 'respond-draw', color: 'white', accept: true }), offered);
    const declined = gameReducer(offered, { type: 'respond-draw', color: 'black', accept: false });
    assert.equal(declined.status.kind, 'playing'); assert.equal(declined.drawOffer, null);
    const drawn = gameReducer(offered, { type: 'respond-draw', color: 'black', accept: true });
    assert.deepEqual(drawn.status, { kind: 'draw', reason: 'agreement' });
    const resigned = gameReducer(initial, { type: 'resign', color: 'white' });
    assert.deepEqual(resigned.status, { kind: 'resigned', winner: 'black' });
    for (const ended of [drawn, resigned]) {
        assert.equal(gameReducer(ended, { type: 'engine-move', move: { from: 52, to: 43, kind: 'm' }, expectedBoard: board, turn: 'white' }), ended);
        const reset = gameReducer(ended, { type: 'restart', board });
        assert.equal(reset.status.kind, 'playing'); assert.equal(reset.halfmoveClock, 0); assert.equal(reset.drawOffer, null);
    }
});

test('analysis sessions can play consecutive engine moves, undo automatic draws and reset history', () => {
    const { analysisReducer } = load('analysis_session');
    const initial = createGame(parseFen('6rk/8/8/8/8/8/8/KR6'), 'white', undefined, 'normal', createStandardState(), 148);
    let session = { game: initial, history: [] };
    for (const [from, to] of [[57, 49], [6, 14]]) {
        session = analysisReducer(session, { type: 'game', action: { type: 'engine-move', move: { from, to, kind: 'm' }, expectedBoard: session.game.board, turn: session.game.turn } });
    }
    assert.equal(session.history.length, 2); assert.equal(session.game.halfmoveClock, 150);
    assert.equal(session.game.status.kind, 'draw');
    session = analysisReducer(session, { type: 'undo' });
    assert.equal(session.game.halfmoveClock, 149); assert.equal(session.game.status.kind, 'playing');
    session = analysisReducer(session, { type: 'undo' });
    assert.deepEqual(session.game, initial);
    assert.deepEqual(analysisReducer(session, { type: 'load', game: initial }), { game: initial, history: [] });
});

test('analysis promotion is one undo step and FEN retains rights, en passant, and the halfmove clock', () => {
    const { analysisReducer } = load('analysis_session');
    const { formatFen } = load('../utils/fen_parcer');
    const initial = createGame(parseFen('7k/2P5/8/8/8/8/8/K7'), 'white', undefined, 'normal');
    let session = { game: initial, history: [] };
    for (const action of [{ type: 'click', square: [1, 2] }, { type: 'click', square: [0, 2] }, { type: 'promote', piece: 'queen' }]) session = analysisReducer(session, { type: 'game', action });
    assert.equal(session.history.length, 1); assert.equal(session.game.board[2], pieceIds.queen);
    session = analysisReducer(session, { type: 'undo' });
    assert.equal(session.game.board[10], pieceIds.pawn); assert.equal(session.game.pendingPromotion, null);
    const fen = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w Kq d6 147 1';
    const parsed = parseBenchmarkFen(fen, 'normal');
    assert.equal(formatFen(parsed.board, parsed.turn, parsed.standard, parsed.halfmoveClock), fen);
    const chaos = parseBenchmarkFen('7k/8/8/8/8/8/8/KD6 w - - 22 1');
    assert.equal(formatFen(chaos.board, chaos.turn, undefined, chaos.halfmoveClock), chaos.fen);
    assert.throws(() => parseBenchmarkFen(chaos.fen, 'normal'));
});

const { encodeMatch, decodeMatch, MATCH_SAVE_MS, matchStorageKey } = load('saved_match');
const saveTime = 1700000000000;
function savedGame(game) {
    return { game, orientation: 'black', evaluationSeed: 42, expiresAt: saveTime + MATCH_SAVE_MS };
}

test('match saves restore standard state, side, clock, and bot seed with a strict three-hour expiry', () => {
    let game = createGame(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'white', undefined, 'normal');
    game = gameReducer(game, { type: 'click', square: [6, 4] });
    game = gameReducer(game, { type: 'click', square: [4, 4] });
    const raw = encodeMatch(savedGame(game));
    const restored = decodeMatch(raw, saveTime + MATCH_SAVE_MS - 1);
    assert.deepEqual(restored.game.board, game.board);
    assert.deepEqual(restored.game.standard, game.standard);
    assert.equal(restored.game.standard.enPassantTarget, 44);
    assert.equal(restored.game.turn, 'black');
    assert.equal(restored.game.halfmoveClock, 0);
    assert.equal(restored.orientation, 'black');
    assert.equal(restored.evaluationSeed, 42);
    assert.equal(restored.game.selectedSquare, null);
    assert.equal(decodeMatch(raw, saveTime + MATCH_SAVE_MS), null);
    assert.notEqual(matchStorageKey(true), matchStorageKey(false));
});

test('match saves preserve Chaos castling history, draw offers and the quiet-move counter', () => {
    const game = createGame(parseFen('4k3/7p/8/8/8/8/P7/4K3 w - - 149 1'), 'white', { white: true, black: false }, 'chaos', undefined, 149);
    game.drawOffer = 'black';
    const restored = decodeMatch(encodeMatch(savedGame(game)), saveTime);
    assert.deepEqual(restored.game.castling, { white: true, black: false });
    assert.equal(restored.game.drawOffer, 'black');
    assert.equal(restored.game.halfmoveClock, 149);
});

test('match saves rebuild a pending promotion and allow its choice to complete legally', () => {
    let game = createGame(parseFen('4k3/P7/8/8/8/8/7p/4K3 w - - 0 1'), 'white', undefined, 'normal');
    game = gameReducer(game, { type: 'click', square: [1, 0] });
    game = gameReducer(game, { type: 'click', square: [0, 0] });
    assert.ok(game.pendingPromotion);
    const restored = decodeMatch(encodeMatch(savedGame(game)), saveTime);
    assert.ok(restored.game.pendingPromotion);
    assert.deepEqual(restored.game.board, game.board);
    assert.deepEqual(restored.game.pendingPromotion.moves, game.pendingPromotion.moves);
    const promoted = gameReducer(restored.game, { type: 'promote', piece: 'queen' });
    assert.equal(promoted.board[0], pieceIds.queen);
    assert.equal(promoted.turn, 'black');
});

test('match restore ignores corrupt, incompatible and impossible saves', () => {
    assert.equal(decodeMatch('{broken', saveTime), null);
    assert.equal(decodeMatch('{}', saveTime), null);
    const game = createGame(parseFen('4k3/7p/8/8/8/8/P7/4K3 w - - 0 1'));
    const data = JSON.parse(encodeMatch(savedGame(game)));
    for (const change of [{ version: 2 }, { board: [] }, { board: Array(64).fill(0) }, { turn: 'purple' }, { halfmoveClock: -1 }, { expiresAt: saveTime + MATCH_SAVE_MS + 1 }, { promotion: { from: 999, to: 0 } }]) {
        assert.equal(decodeMatch(JSON.stringify({ ...data, ...change }), saveTime), null);
    }
});
