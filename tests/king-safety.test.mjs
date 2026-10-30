import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Load the project's TypeScript modules without changing the Next.js compiler setup.
const modules = new Map();
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(fileURLToPath(new URL(`../src/components/common/${name}.ts`, import.meta.url)), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(
        (id) => load(id.replace('./', '')), loadedModule, loadedModule.exports,
    );
    modules.set(name, loadedModule.exports);
    return loadedModule.exports;
}

const { makePiece, pieceDefinitions, pieceIds, pieceColor, pieceName } = load('pieces');
const { parseFen } = load('fen_parcer');
const { applyMove } = load('apply_move');
const { findKing, isKingSafe } = load('king_safety');
const generate = load('legal_move').default;
const { createGame, gameReducer, getGameStatus } = load('game_state');

function position(...pieces) {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (const [row, col, piece] of pieces) board[row][col] = piece;
    return board;
}

test('known king squares avoid scans and must match the resulting board', () => {
    const board = position([7, 4, makePiece('king', 'white')], [0, 4, makePiece('king', 'black')]);
    assert.equal(findKing(board, pieceIds.king), 60);
    assert.equal(findKing(board, -pieceIds.king), 4);
    assert.equal(findKing(position(), pieceIds.king), -1);
    for (const rank of board) {
        rank.indexOf = () => { throw new Error('Unexpected king search'); };
    }
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
        for (const rank of board) {
            rank.indexOf = function (...args) {
                searches++;
                return Array.prototype.indexOf.apply(this, args);
            };
        }
        assert.ok(generate(board, [4, 3]).length > 10);
        // White is found in the eighth rank scanned, Black in the first.
        assert.equal(searches, 9);
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
        board[4 - dr][4 - dc] = makePiece('pawn', 'white');
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
    const moves = generate(board, [6, 4]);
    assert.ok(moves.some((m) => m.to === 4 && m.kind === 'c'));
    assert.ok(moves.some((m) => m.to === 44 && m.kind === 'm'));
    assert.ok(moves.every((m) => m.to % 8 === 4));
    assert.deepEqual(board, snapshot);
});

test('a move must resolve an existing check, including by blocking it', () => {
    const board = position([7, 4, makePiece('king', 'white')], [6, 0, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')]);
    assert.deepEqual(generate(board, [6, 0]), [{ from: 48, to: 52, kind: 'm' }]);
});

test('king moves are checked after vacating the origin and after captures', () => {
    const board = position([4, 4, makePiece('king', 'white')], [4, 0, makePiece('rook', 'black')], [3, 4, makePiece('pawn', 'black')], [0, 4, makePiece('rook', 'black')]);
    const moves = generate(board, [4, 4]);
    assert.ok(!moves.some((m) => m.to === 37)); // Origin previously blocked this ray.
    assert.ok(!moves.some((m) => m.to === 28)); // Capturing exposes the protecting rook.
    const capture = generate(position([4, 4, makePiece('king', 'white')], [3, 4, makePiece('pawn', 'black')]), [4, 4]);
    assert.ok(capture.some((m) => m.to === 28 && m.kind === 'c'));
});

test('pinned enemies still attack and kings cannot become adjacent or be captured', () => {
    const board = position([4, 4, makePiece('king', 'white')], [3, 3, makePiece('knight', 'black')], [0, 3, makePiece('king', 'black')], [7, 3, makePiece('rook', 'white')]);
    assert.equal(isKingSafe(board, 'white'), false);
    const kings = position([4, 4, makePiece('king', 'white')], [2, 4, makePiece('king', 'black')]);
    assert.ok(!generate(kings, [4, 4]).some((m) => m.to === 28));
    const capture = position([7, 7, makePiece('king', 'white')], [4, 4, makePiece('rook', 'white')], [4, 0, makePiece('king', 'black')]);
    assert.ok(!generate(capture, [4, 4]).some((m) => m.to === 32));
});

test('checkers capture removes the jumped piece before checking for exposed attacks', () => {
    const board = position([4, 7, makePiece('king', 'white')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'black')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(!generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4][0] = 0;
    assert.ok(generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
});

test('checkers capture can resolve check, but cannot capture the enemy king', () => {
    const board = position([4, 7, makePiece('king', 'white')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('rook', 'black')]);
    assert.ok(generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4][3] = makePiece('king', 'black');
    assert.ok(!generate(board, [5, 2]).some((m) => m.kind === 'ch'));
});

test('moving into a checkers landing square can stop its threat', () => {
    const board = position([4, 4, makePiece('king', 'white')], [3, 3, makePiece('bishop', 'black')], [5, 7, makePiece('rook', 'white')]);
    assert.equal(isKingSafe(board, 'white'), false);
    assert.ok(generate(board, [5, 7]).some((m) => m.to === 45));
});

test('rotation is simulated without removing the rook and cannot ignore check', () => {
    const board = position([7, 4, makePiece('king', 'white')], [6, 4, makePiece('rook', 'white')], [0, 4, makePiece('rook', 'black')]);
    const snapshot = structuredClone(board);
    assert.ok(generate(board, [6, 4]).some((m) => m.kind === 'rotate' && m.piece === 'diagonalrook'));
    board[6][4] = makePiece('diagonalrook', 'white');
    assert.ok(generate(board, [6, 4]).some((m) => m.kind === 'rotate' && m.piece === 'rook'));
    board[6][4] = 0;
    board[6][0] = makePiece('rook', 'white');
    assert.ok(!generate(board, [6, 0]).some((m) => m.kind === 'rotate'));
    assert.equal(snapshot[6][4], makePiece('rook', 'white'));
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
    assert.equal(afterWhite.board[6][3], 0);
    assert.equal(afterWhite.board[5][2], makePiece('pawn', 'white'));
    assert.deepEqual(afterWhite.lastMove, { from: 51, to: 42, kind: 'm' });
    assert.equal(click(afterWhite, 5, 2), afterWhite);
    const afterBlack = click(click(afterWhite, 1, 3), 2, 2);
    assert.equal(afterBlack.turn, 'white');
    assert.equal(afterBlack.board[2][2], makePiece('pawn', 'black'));
    assert.deepEqual(state, snapshot);
});

test('live checkers capture removes the jumped piece and spends one turn', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'black')]));
    const next = click(click(state, 5, 2), 3, 4);
    assert.equal(next.board[5][2], 0);
    assert.equal(next.board[4][3], 0);
    assert.equal(next.board[3][4], makePiece('bishop', 'white'));
    assert.equal(next.lastMove.kind, 'ch');
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(state.board[4][3], makePiece('pawn', 'black'));
});

test('live ordinary capture replaces its target', () => {
    const state = createGame(position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 2, makePiece('rook', 'white')], [4, 4, makePiece('pawn', 'black')]));
    const next = click(click(state, 4, 2), 4, 4);
    assert.equal(next.board[4][2], 0);
    assert.equal(next.board[4][4], makePiece('rook', 'white'));
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
    assert.equal(next.board[6][0], makePiece('diagonalrook', 'white'));
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
    assert.equal(escaped.board[1][0], makePiece('king', 'black'));
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
    const board = Array.from({ length: 8 }, () => Array(8).fill(makePiece('pawn', 'white')));
    board[0][0] = makePiece('king', 'white');
    board[7][7] = makePiece('king', 'black');
    board[3][3] = makePiece('rook', 'white');
    assert.deepEqual(generate(board, [3, 3]), [{ from: 27, to: 27, kind: 'rotate', piece: 'diagonalrook' }]);
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'playing' });
    board[3][3] = makePiece('pawn', 'white');
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'stalemate' });
});

test('rotation also evaluates whether the opponent is now in check', () => {
    const board = position([7, 7, makePiece('king', 'white')], [0, 0, makePiece('king', 'black')], [2, 2, makePiece('rook', 'white')]);
    const state = createGame(board);
    const next = gameReducer(click(state, 2, 2), { type: 'rotate' });
    assert.equal(next.board[2][2], makePiece('diagonalrook', 'white'));
    assert.equal(next.turn, 'black');
    assert.equal(next.status.kind, 'check');
});

test('restart clears the result, last move, and selection and starts White', () => {
    const ended = createGame(position([0, 0, makePiece('king', 'black')], [2, 1, makePiece('knight', 'white')], [7, 7, makePiece('king', 'white')]), 'black');
    assert.equal(ended.status.kind, 'stalemate');
    const board = position([0, 0, makePiece('king', 'black')], [7, 7, makePiece('king', 'white')]);
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
            const move = generate(board, [4, 4]).find((m) => m.to === toRow * 8 + toCol);
            assert.equal(move?.kind, 'm');
            const next = click(click(createGame(board, color), 4, 4), toRow, toCol);
            assert.equal(next.board[4][4], 0);
            assert.equal(next.board[4 + dr][4 + dc], makePiece('pawn', color));
            assert.equal(next.board[toRow][toCol], makePiece('bishop', color));
            assert.equal(next.turn, color === 'white' ? 'black' : 'white');
            assert.equal(next.selectedSquare, null);
            assert.equal(board[4][4], makePiece('bishop', color));
        }
    }
});

test('allied jumps require an empty on-board landing square and cannot jump empty squares', () => {
    for (const blocker of [makePiece('pawn', 'white'), makePiece('pawn', 'black')]) {
        const board = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', 'white')], [3, 3, makePiece('pawn', 'white')], [2, 2, blocker]);
        assert.ok(!generate(board, [4, 4]).some((m) => m.to === 18));
    }
    const edge = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [1, 1, makePiece('bishop', 'white')], [0, 0, makePiece('pawn', 'white')]);
    assert.ok(generate(edge, [1, 1]).every((m) => m.to >= 0 && m.to < 64));
    const empty = position([7, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', 'white')]);
    assert.ok(!generate(empty, [4, 4]).some((m) => m.to === 18));
});

test('allied jumps preserve king safety, including jumping over your own king', () => {
    const blocked = position([4, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [5, 2, makePiece('bishop', 'white')], [4, 3, makePiece('pawn', 'white')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(generate(blocked, [5, 2]).some((m) => m.to === 28 && m.kind === 'm'));
    const pinned = position([4, 7, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 3, makePiece('bishop', 'white')], [3, 2, makePiece('pawn', 'white')], [4, 0, makePiece('rook', 'black')]);
    assert.ok(!generate(pinned, [4, 3]).some((m) => m.to === 17));
    const kingJump = position([3, 3, makePiece('king', 'white')], [0, 7, makePiece('king', 'black')], [4, 4, makePiece('bishop', 'white')]);
    const next = click(click(createGame(kingJump), 4, 4), 2, 2);
    assert.equal(next.board[3][3], makePiece('king', 'white'));
    assert.equal(next.board[2][2], makePiece('bishop', 'white'));
});

for (const color of ['white', 'black']) {
    const enemy = color === 'white' ? 'black' : 'white';
    const row = color === 'white' ? 1 : 6;
    const endRow = color === 'white' ? 0 : 7;
    const kingRow = color === 'white' ? 7 : 0;
    for (const capture of [false, true]) {
        test(`${color} pawn ${capture ? 'capture' : 'move'} pauses for promotion and blocks other moves`, () => {
            const board = position([kingRow, 7, makePiece('king', color)], [endRow, 7, makePiece('king', enemy)], [row, capture ? 0 : 1, makePiece('pawn', color)]);
            if (capture) board[endRow][0] = makePiece('knight', enemy);
            let state = createGame(board, color);
            state = gameReducer(state, { type: 'click', square: [row, capture ? 0 : 1] });
            state = gameReducer(state, { type: 'click', square: [endRow, 0] });
            assert.deepEqual(state.pendingPromotion, { square: [endRow, 0], color });
            assert.equal(state.turn, color);
            assert.equal(state.board[endRow][0], makePiece('pawn', color));
            assert.equal(state.selectedSquare, null);
            assert.equal(gameReducer(state, { type: 'click', square: [kingRow, 7] }), state);
            assert.equal(gameReducer(state, { type: 'rotate' }), state);
            assert.equal(gameReducer(state, { type: 'promote', piece: 'king' }), state);
            for (const piece of ['queen', 'rook', 'bishop', 'knight']) {
                const promoted = gameReducer(state, { type: 'promote', piece });
                assert.equal(promoted.board[endRow][0], makePiece(piece, color));
                assert.equal(promoted.pendingPromotion, null);
                assert.equal(promoted.turn, enemy);
                assert.deepEqual(promoted.lastMove, state.lastMove);
                assert.equal(state.board[endRow][0], makePiece('pawn', color), 'promotion must not mutate the pending board');
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
    assert.deepEqual(board[0], [-4, -2, -3, -6, -7, -3, -2, -4]);
    assert.deepEqual(board[7], [4, 2, 3, 6, 7, 3, 2, 4]);
    assert.deepEqual(board[2], Array(8).fill(0));
    assert.ok(board.flat().every(Number.isInteger));
    assert.throws(() => parseFen('8/8/8/8/8/8/8/7x'), /Unknown FEN piece/);
    assert.throws(() => parseFen('8/8/8'), /eight ranks/);
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
                const move = generate(board, [4, 4]).find(m => m.kind === 'rotate');
                assert.equal(move.piece, definition.rotatesTo);
                const rotated = applyMove(board, move);
                assert.equal(rotated[4][4], makePiece(definition.rotatesTo, color));
                const back = generate(rotated, [4, 4]).find(m => m.kind === 'rotate');
                assert.deepEqual(applyMove(rotated, back), board);
                assert.deepEqual(board, snapshot);
            }
        }
        for (const color of ['white', 'black']) {
            assert.ok(fs.existsSync(fileURLToPath(new URL(`../public/pieces/${color}-${definition.image}.svg`, import.meta.url))));
        }
    }
});
