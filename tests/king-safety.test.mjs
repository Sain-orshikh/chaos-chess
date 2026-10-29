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

const { isKingSafe } = load('king_safety');
const generate = load('legal_move').default;
const { createGame, gameReducer, getGameStatus } = load('game_state');

function position(...pieces) {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (const [row, col, piece] of pieces) board[row][col] = piece;
    return board;
}

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
            const board = position([4, 4, `${color}-king`], [row, col, `${enemy}-${type}`]);
            assert.equal(isKingSafe(board, color), safe);
        });
    }

    test(`${color} king: pawn direction and capture pattern`, () => {
        const sourceRow = enemy === 'white' ? 5 : 3;
        assert.equal(isKingSafe(position([4, 4, `${color}-king`], [sourceRow, 4, `${enemy}-pawn`]), color), false);
        assert.equal(isKingSafe(position([4, 4, `${color}-king`], [sourceRow, 3, `${enemy}-pawn`]), color), true);
        assert.equal(isKingSafe(position([4, 4, `${color}-king`], [8 - sourceRow, 4, `${enemy}-pawn`]), color), true);
    });
}

test('both friendly and enemy pieces block attack rays and short-range knights', () => {
    for (const blocker of ['white-pawn', 'black-pawn']) {
        for (const attacker of ['black-rook', 'black-knight']) {
            const board = position([4, 4, 'white-king'], [4, 2, attacker], [4, 3, blocker]);
            assert.equal(isKingSafe(board, 'white'), true);
        }
    }
});

test('checkers attacks require an on-board empty landing square in every direction', () => {
    for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
        const board = position([4, 4, 'white-king'], [4 + dr, 4 + dc, 'black-bishop']);
        assert.equal(isKingSafe(board, 'white'), false);
        board[4 - dr][4 - dc] = 'white-pawn';
        assert.equal(isKingSafe(board, 'white'), true);
    }
    assert.equal(isKingSafe(position([0, 0, 'white-king'], [1, 1, 'black-bishop']), 'white'), true);
});

test('missing king is unsafe; all edge squares are checked without wrapping', () => {
    assert.equal(isKingSafe(position(), 'white'), false);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        assert.equal(isKingSafe(position([r, c, 'white-king']), 'white'), true);
    }
});

test('a pinned rook can stay on the ray or capture its attacker, but cannot leave the ray', () => {
    const board = position([7, 4, 'white-king'], [6, 4, 'white-rook'], [0, 4, 'black-rook']);
    const snapshot = structuredClone(board);
    const moves = generate(board, [6, 4]);
    assert.ok(moves.some((m) => m.to === 4 && m.kind === 'c'));
    assert.ok(moves.some((m) => m.to === 44 && m.kind === 'm'));
    assert.ok(moves.every((m) => m.to % 8 === 4));
    assert.deepEqual(board, snapshot);
});

test('a move must resolve an existing check, including by blocking it', () => {
    const board = position([7, 4, 'white-king'], [6, 0, 'white-rook'], [0, 4, 'black-rook']);
    assert.deepEqual(generate(board, [6, 0]), [{ from: 48, to: 52, kind: 'm' }]);
});

test('king moves are checked after vacating the origin and after captures', () => {
    const board = position([4, 4, 'white-king'], [4, 0, 'black-rook'], [3, 4, 'black-pawn'], [0, 4, 'black-rook']);
    const moves = generate(board, [4, 4]);
    assert.ok(!moves.some((m) => m.to === 37)); // Origin previously blocked this ray.
    assert.ok(!moves.some((m) => m.to === 28)); // Capturing exposes the protecting rook.
    const capture = generate(position([4, 4, 'white-king'], [3, 4, 'black-pawn']), [4, 4]);
    assert.ok(capture.some((m) => m.to === 28 && m.kind === 'c'));
});

test('pinned enemies still attack and kings cannot become adjacent or be captured', () => {
    const board = position([4, 4, 'white-king'], [3, 3, 'black-knight'], [0, 3, 'black-king'], [7, 3, 'white-rook']);
    assert.equal(isKingSafe(board, 'white'), false);
    const kings = position([4, 4, 'white-king'], [2, 4, 'black-king']);
    assert.ok(!generate(kings, [4, 4]).some((m) => m.to === 28));
    const capture = position([7, 7, 'white-king'], [4, 4, 'white-rook'], [4, 0, 'black-king']);
    assert.ok(!generate(capture, [4, 4]).some((m) => m.to === 32));
});

test('checkers capture removes the jumped piece before checking for exposed attacks', () => {
    const board = position([4, 7, 'white-king'], [5, 2, 'white-bishop'], [4, 3, 'black-pawn'], [4, 0, 'black-rook']);
    assert.ok(!generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4][0] = null;
    assert.ok(generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
});

test('checkers capture can resolve check, but cannot capture the enemy king', () => {
    const board = position([4, 7, 'white-king'], [5, 2, 'white-bishop'], [4, 3, 'black-rook']);
    assert.ok(generate(board, [5, 2]).some((m) => m.to === 28 && m.kind === 'ch'));
    board[4][3] = 'black-king';
    assert.ok(!generate(board, [5, 2]).some((m) => m.kind === 'ch'));
});

test('moving into a checkers landing square can stop its threat', () => {
    const board = position([4, 4, 'white-king'], [3, 3, 'black-bishop'], [5, 7, 'white-rook']);
    assert.equal(isKingSafe(board, 'white'), false);
    assert.ok(generate(board, [5, 7]).some((m) => m.to === 45));
});

test('rotation is simulated without removing the rook and cannot ignore check', () => {
    const board = position([7, 4, 'white-king'], [6, 4, 'white-rook'], [0, 4, 'black-rook']);
    const snapshot = structuredClone(board);
    assert.ok(generate(board, [6, 4]).some((m) => m.kind === 'rotate' && m.piece === 'diagonalrook'));
    board[6][4] = 'white-diagonalrook';
    assert.ok(generate(board, [6, 4]).some((m) => m.kind === 'rotate' && m.piece === 'rook'));
    board[6][4] = null;
    board[6][0] = 'white-rook';
    assert.ok(!generate(board, [6, 0]).some((m) => m.kind === 'rotate'));
    assert.equal(snapshot[6][4], 'white-rook');
});

const click = (state, row, col) => gameReducer(state, { type: 'click', square: [row, col] });

test('local play starts with white and only the active color can be selected', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 3, 'white-pawn'], [1, 3, 'black-pawn']));
    assert.equal(state.turn, 'white');
    assert.equal(click(state, 1, 3), state);
    assert.equal(click(state, 4, 4), state);
    assert.deepEqual(click(state, 6, 3).selectedSquare, [6, 3]);
});

test('returning a piece to its origin cancels without changing turn, board, or last move', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 3, 'white-pawn']));
    const cancelled = click(click(state, 6, 3), 6, 3);
    assert.deepEqual(cancelled, state);
    assert.equal(cancelled.board, state.board);
});

test('illegal placement retains selection and does not spend a turn', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 3, 'white-pawn']));
    const selected = click(state, 6, 3);
    assert.equal(click(selected, 5, 3), selected); // Custom pawns cannot advance straight.
    assert.equal(click(selected, 7, 7), selected); // Friendly occupied destination.
    assert.equal(click(selected, -1, 3), selected);
});

test('legal white and black moves alternate turns, clear selection, and record the last move', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 3, 'white-pawn'], [1, 3, 'black-pawn']));
    const snapshot = structuredClone(state);
    const afterWhite = click(click(state, 6, 3), 5, 2);
    assert.equal(afterWhite.turn, 'black');
    assert.equal(afterWhite.selectedSquare, null);
    assert.equal(afterWhite.board[6][3], null);
    assert.equal(afterWhite.board[5][2], 'white-pawn');
    assert.deepEqual(afterWhite.lastMove, { from: 51, to: 42, kind: 'm' });
    assert.equal(click(afterWhite, 5, 2), afterWhite);
    const afterBlack = click(click(afterWhite, 1, 3), 2, 2);
    assert.equal(afterBlack.turn, 'white');
    assert.equal(afterBlack.board[2][2], 'black-pawn');
    assert.deepEqual(state, snapshot);
});

test('live checkers capture removes the jumped piece and spends one turn', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [5, 2, 'white-bishop'], [4, 3, 'black-pawn']));
    const next = click(click(state, 5, 2), 3, 4);
    assert.equal(next.board[5][2], null);
    assert.equal(next.board[4][3], null);
    assert.equal(next.board[3][4], 'white-bishop');
    assert.equal(next.lastMove.kind, 'ch');
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(state.board[4][3], 'black-pawn');
});

test('live ordinary capture replaces its target', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [4, 2, 'white-rook'], [4, 4, 'black-pawn']));
    const next = click(click(state, 4, 2), 4, 4);
    assert.equal(next.board[4][2], null);
    assert.equal(next.board[4][4], 'white-rook');
    assert.equal(next.lastMove.kind, 'c');
    assert.equal(next.turn, 'black');
});

test('live play rejects moves exposing the king', () => {
    const state = createGame(position([7, 4, 'white-king'], [6, 4, 'white-rook'], [0, 4, 'black-rook'], [0, 0, 'black-king']));
    const selected = click(state, 6, 4);
    assert.equal(click(selected, 6, 5), selected);
});

test('rook switching is a separate action that transforms in place and spends the turn', () => {
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 0, 'white-rook']));
    assert.equal(gameReducer(state, { type: 'rotate' }), state);
    const selected = click(state, 6, 0);
    const next = gameReducer(selected, { type: 'rotate' });
    assert.equal(next.board[6][0], 'white-diagonalrook');
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(click(selected, 6, 0).turn, 'white');
    const pawn = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [6, 0, 'white-pawn']));
    const selectedPawn = click(pawn, 6, 0);
    assert.equal(gameReducer(selectedPawn, { type: 'rotate' }), selectedPawn);
});

test('check with an escape is not checkmate', () => {
    const board = position([0, 0, 'black-king'], [0, 2, 'white-rook'], [7, 7, 'white-king']);
    assert.deepEqual(getGameStatus(board, 'black'), { kind: 'check' });
    const state = createGame(board, 'black');
    const escaped = click(click(state, 0, 0), 1, 0);
    assert.equal(escaped.board[1][0], 'black-king');
    assert.equal(escaped.turn, 'white');
});

test('checkmate is detected for either color', () => {
    for (const loser of ['white', 'black']) {
        const winner = loser === 'white' ? 'black' : 'white';
        const board = position([0, 0, `${loser}-king`], [0, 2, `${winner}-rook`], [1, 2, `${winner}-rook`], [7, 7, `${winner}-king`]);
        assert.deepEqual(getGameStatus(board, loser), { kind: 'checkmate', winner });
        assert.deepEqual(createGame(board, loser).status, { kind: 'checkmate', winner });
    }
});

test('a completed move detects mate and freezes all further board actions', () => {
    const board = position([0, 0, 'black-king'], [0, 2, 'white-rook'], [2, 2, 'white-rook'], [7, 7, 'white-king']);
    const next = click(click(createGame(board), 2, 2), 1, 2);
    assert.deepEqual(next.status, { kind: 'checkmate', winner: 'white' });
    assert.equal(next.turn, 'black');
    assert.equal(next.selectedSquare, null);
    assert.equal(click(next, 0, 0), next);
    assert.equal(gameReducer(next, { type: 'rotate' }), next);
});

test('a completed move detects stalemate using custom knight attacks', () => {
    const board = position([0, 0, 'black-king'], [3, 1, 'white-knight'], [7, 7, 'white-king']);
    const next = click(click(createGame(board), 3, 1), 2, 1);
    assert.equal(next.turn, 'black');
    assert.deepEqual(next.status, { kind: 'stalemate' });
    assert.equal(isKingSafe(next.board, 'black'), true);
    assert.equal(click(next, 0, 0), next);
});

test('a legal rook rotation prevents stalemate even when no piece can move', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill('white-pawn'));
    board[0][0] = 'white-king';
    board[7][7] = 'black-king';
    board[3][3] = 'white-rook';
    assert.deepEqual(generate(board, [3, 3]), [{ from: 27, to: 27, kind: 'rotate', piece: 'diagonalrook' }]);
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'playing' });
    board[3][3] = 'white-pawn';
    assert.deepEqual(getGameStatus(board, 'white'), { kind: 'stalemate' });
});

test('rotation also evaluates whether the opponent is now in check', () => {
    const board = position([7, 7, 'white-king'], [0, 0, 'black-king'], [2, 2, 'white-rook']);
    const state = createGame(board);
    const next = gameReducer(click(state, 2, 2), { type: 'rotate' });
    assert.equal(next.board[2][2], 'white-diagonalrook');
    assert.equal(next.turn, 'black');
    assert.equal(next.status.kind, 'check');
});

test('restart clears the result, last move, and selection and starts White', () => {
    const ended = createGame(position([0, 0, 'black-king'], [2, 1, 'white-knight'], [7, 7, 'white-king']), 'black');
    assert.equal(ended.status.kind, 'stalemate');
    const board = position([0, 0, 'black-king'], [7, 7, 'white-king']);
    const next = gameReducer(ended, { type: 'restart', board });
    assert.deepEqual(next, createGame(board));
    assert.equal(next.turn, 'white');
    assert.equal(next.status.kind, 'playing');
    assert.deepEqual(click(next, 7, 7).selectedSquare, [7, 7]);
});

test('bishops of either color can jump allies in all four directions without capturing', () => {
    for (const color of ['white', 'black']) {
        for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
            const board = position([7, 7, 'white-king'], [0, 7, 'black-king'], [4, 4, `${color}-bishop`], [4 + dr, 4 + dc, `${color}-pawn`]);
            const toRow = 4 + dr * 2, toCol = 4 + dc * 2;
            const move = generate(board, [4, 4]).find((m) => m.to === toRow * 8 + toCol);
            assert.equal(move?.kind, 'm');
            const next = click(click(createGame(board, color), 4, 4), toRow, toCol);
            assert.equal(next.board[4][4], null);
            assert.equal(next.board[4 + dr][4 + dc], `${color}-pawn`);
            assert.equal(next.board[toRow][toCol], `${color}-bishop`);
            assert.equal(next.turn, color === 'white' ? 'black' : 'white');
            assert.equal(next.selectedSquare, null);
            assert.equal(board[4][4], `${color}-bishop`);
        }
    }
});

test('allied jumps require an empty on-board landing square and cannot jump empty squares', () => {
    for (const blocker of ['white-pawn', 'black-pawn']) {
        const board = position([7, 7, 'white-king'], [0, 7, 'black-king'], [4, 4, 'white-bishop'], [3, 3, 'white-pawn'], [2, 2, blocker]);
        assert.ok(!generate(board, [4, 4]).some((m) => m.to === 18));
    }
    const edge = position([7, 7, 'white-king'], [0, 7, 'black-king'], [1, 1, 'white-bishop'], [0, 0, 'white-pawn']);
    assert.ok(generate(edge, [1, 1]).every((m) => m.to >= 0 && m.to < 64));
    const empty = position([7, 7, 'white-king'], [0, 7, 'black-king'], [4, 4, 'white-bishop']);
    assert.ok(!generate(empty, [4, 4]).some((m) => m.to === 18));
});

test('allied jumps preserve king safety, including jumping over your own king', () => {
    const blocked = position([4, 7, 'white-king'], [0, 7, 'black-king'], [5, 2, 'white-bishop'], [4, 3, 'white-pawn'], [4, 0, 'black-rook']);
    assert.ok(generate(blocked, [5, 2]).some((m) => m.to === 28 && m.kind === 'm'));
    const pinned = position([4, 7, 'white-king'], [0, 7, 'black-king'], [4, 3, 'white-bishop'], [3, 2, 'white-pawn'], [4, 0, 'black-rook']);
    assert.ok(!generate(pinned, [4, 3]).some((m) => m.to === 17));
    const kingJump = position([3, 3, 'white-king'], [0, 7, 'black-king'], [4, 4, 'white-bishop']);
    const next = click(click(createGame(kingJump), 4, 4), 2, 2);
    assert.equal(next.board[3][3], 'white-king');
    assert.equal(next.board[2][2], 'white-bishop');
});

for (const color of ['white', 'black']) {
    const enemy = color === 'white' ? 'black' : 'white';
    const row = color === 'white' ? 1 : 6;
    const endRow = color === 'white' ? 0 : 7;
    const kingRow = color === 'white' ? 7 : 0;
    for (const capture of [false, true]) {
        test(`${color} pawn ${capture ? 'capture' : 'move'} pauses for promotion and blocks other moves`, () => {
            const board = position([kingRow, 7, `${color}-king`], [endRow, 7, `${enemy}-king`], [row, capture ? 0 : 1, `${color}-pawn`]);
            if (capture) board[endRow][0] = `${enemy}-knight`;
            let state = createGame(board, color);
            state = gameReducer(state, { type: 'click', square: [row, capture ? 0 : 1] });
            state = gameReducer(state, { type: 'click', square: [endRow, 0] });
            assert.deepEqual(state.pendingPromotion, { square: [endRow, 0], color });
            assert.equal(state.turn, color);
            assert.equal(state.board[endRow][0], `${color}-pawn`);
            assert.equal(state.selectedSquare, null);
            assert.equal(gameReducer(state, { type: 'click', square: [kingRow, 7] }), state);
            assert.equal(gameReducer(state, { type: 'rotate' }), state);
            assert.equal(gameReducer(state, { type: 'promote', piece: 'king' }), state);
            for (const piece of ['queen', 'rook', 'bishop', 'knight']) {
                const promoted = gameReducer(state, { type: 'promote', piece });
                assert.equal(promoted.board[endRow][0], `${color}-${piece}`);
                assert.equal(promoted.pendingPromotion, null);
                assert.equal(promoted.turn, enemy);
                assert.deepEqual(promoted.lastMove, state.lastMove);
                assert.equal(state.board[endRow][0], `${color}-pawn`, 'promotion must not mutate the pending board');
            }
            assert.equal(gameReducer(state, { type: 'restart', board }).pendingPromotion, null);
        });
    }
}

test('a rook moving to or rotating on the back rank does not trigger promotion', () => {
    let state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [1, 0, 'white-rook']));
    state = gameReducer(state, { type: 'click', square: [1, 0] });
    state = gameReducer(state, { type: 'click', square: [0, 0] });
    assert.equal(state.pendingPromotion, null);
    assert.equal(state.turn, 'black');
    let black = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king'], [0, 0, 'black-rook']), 'black');
    black = gameReducer(black, { type: 'click', square: [0, 0] });
    black = gameReducer(black, { type: 'rotate' });
    assert.equal(black.pendingPromotion, null);
    assert.equal(black.turn, 'white');
});

test('checkmate is evaluated after the chosen promotion piece is placed', () => {
    let state = createGame(position([2, 1, 'white-king'], [2, 3, 'white-knight'], [1, 2, 'white-pawn'], [0, 0, 'black-king']));
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
    const state = createGame(position([7, 7, 'white-king'], [0, 7, 'black-king']));
    assert.equal(gameReducer(state, { type: 'promote', piece: 'queen' }), state);
});
