import assert from 'node:assert/strict';
import { load, parseFen } from './engine-tools.mjs';
const { materialBalance, materialForSide } = load('material');
const start = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
assert.equal(materialBalance(start, 'normal').whiteAdvantage, 0);
assert.equal(materialBalance(start, 'chaos').whiteAdvantage, 0);
const missingPawns = [...start]; missingPawns[8] = missingPawns[9] = 0;
const balance = materialBalance(missingPawns, 'normal');
assert.equal(materialForSide(balance, 'white').advantage, 2);
assert.deepEqual(materialForSide(balance, 'white').pieces, [-1, -1]);
assert.equal(materialForSide(balance, 'black').advantage, -2);
const minorTrade = [...start]; minorTrade[1] = 0; minorTrade[58] = 0;
assert.equal(materialBalance(minorTrade, 'normal').whiteAdvantage, 0);
assert.equal(materialBalance(minorTrade, 'chaos').whiteAdvantage, 2);
const rotated = [...start]; rotated[56] = 5;
assert.equal(materialBalance(rotated, 'chaos').whiteAdvantage, 0);
assert.deepEqual(materialForSide(materialBalance(rotated, 'chaos'), 'white').pieces, []);
const promoted = [...start]; promoted[48] = 6;
assert.equal(materialBalance(promoted, 'normal').whiteAdvantage, 8);
console.log('Material display: standard values, Havoc values, captures, rotation, and promotion passed.');

const { createGame, gameReducer } = load('game_state');
const { encodeMatch, decodeMatch } = load('saved_match');
function play(game, from, to) {
    game = gameReducer(game, { type: 'click', square: [Math.floor(from / 8), from % 8] });
    return gameReducer(game, { type: 'click', square: [Math.floor(to / 8), to % 8] });
}
let game = createGame(start, 'white', undefined, 'normal');
game = play(game, 52, 36); // e4
game = play(game, 11, 27); // d5
game = play(game, 36, 27); // exd5
assert.deepEqual(game.capturedPieces, [-1]);
game = play(game, 3, 27); // Qxd5: material equalizes, both captures stay.
assert.equal(materialBalance(game.board, 'normal').whiteAdvantage, 0);
assert.deepEqual(game.capturedPieces, [-1, 1]);
const restored = decodeMatch(encodeMatch({ game, orientation: 'white', evaluationSeed: 1, expiresAt: Date.now() + 60000 }));
assert.deepEqual(restored.game.capturedPieces, [-1, 1]);
assert.deepEqual(gameReducer(game, { type: 'restart', board: start }).capturedPieces, []);
console.log('Captured pieces persist through equal trades and saved matches; restart clears them.');
