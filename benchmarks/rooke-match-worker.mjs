// JSON-lines bridge to the actual app search, without bundling or UI overhead.
import fs from 'node:fs';
import readline from 'node:readline';
import ts from 'typescript';

const modules = new Map();
function load(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports;
    const loadedModule = { exports: {} };
    modules.set(url.href, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(
        id => load(new URL(`${id}.ts`, url)), loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
}
const common = new URL('../src/components/common/', import.meta.url);
const { searchBot, defaultBotSettings } = load(new URL('bot_search.ts', common));
const { parseFen, standardStateFromFen } = load(new URL('../utils/fen_parcer.ts', common));
const { createCastlingState } = load(new URL('../utils/types.ts', common));
const { legalMovesForPiece } = load(new URL('rules.ts', common));
const square = index => `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
const promotions = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const uci = move => `${square(move.from)}${square(move.to)}${move.promotion ? promotions[move.promotion] : ''}`;

for await (const line of readline.createInterface({ input: process.stdin })) {
    try {
        const request = JSON.parse(line);
        const board = parseFen(request.fen);
        const turn = request.fen.split(' ')[1] === 'w' ? 'white' : 'black';
        const standard = standardStateFromFen(request.fen), castling = createCastlingState();
        const legal = board.flatMap((piece, index) => piece && (piece > 0) === (turn === 'white')
            ? legalMovesForPiece(board, index, castling, standard).map(uci) : []);
        const result = searchBot({ board, turn, standard, castling,
            halfmoveClock: Number(request.fen.split(' ')[4]), evaluationSeed: request.seed,
            settings: { ...defaultBotSettings, maxTimeMs: request.timeMs ?? 3000 },
        });
        process.stdout.write(JSON.stringify({ move: result.move ? uci(result.move) : null, legal,
            depth: result.completedDepth, elapsedMs: result.stats.elapsedMs, limit: result.limit, fallback: result.fallback }) + '\n');
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: error.stack ?? String(error) }) + '\n');
    }
}
