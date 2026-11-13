// Download a.tsv through e.tsv at SOURCE_REVISION, then pass their directory here.
// Usage: node scripts/import-opening-book.js /path/to/chess-openings
import fs from 'node:fs';
import path from 'node:path';
import { load, uci } from '../tests/engine-tools.mjs';
const SOURCE_REVISION = '3ba6b20d31b2e6125cb0e6a2e792f400717d9d39';
const selections = [
    ['C88', 'Ruy Lopez: Closed', 18],
    ['C54', 'Italian Game: Classical Variation, Giuoco Pianissimo, Main Line', 16],
    ['C45', 'Scotch Game: Paulsen, Gunsberg Defense', 6],
    ['C42', "Petrov's Defense: Classical Attack, Berger Variation", 5],
    ['B90', 'Sicilian Defense: Najdorf Variation, English Attack', 12],
    ['B75', 'Sicilian Defense: Dragon Variation, Yugoslav Attack, Belezky Line', 8],
    ['C13', 'French Defense: Classical Variation, Burn Variation, Main Line', 10],
    ['B19', 'Caro-Kann Defense: Classical Variation', 10],
    ['D61', "Queen's Gambit Declined: Orthodox Defense, Rubinstein Variation", 18],
    ['D19', 'Slav Defense: Czech Variation, Classical System, Main Line', 10],
    ['E94', "King's Indian Defense: Orthodox Variation, Donner Defense", 12],
    ['E53', 'Nimzo-Indian Defense: Normal Variation, Gligoric System', 8],
    ['A29', "English Opening: King's English Variation, Four Knights Variation, Fianchetto Line", 14],
    ['A07', "King's Indian Attack: Keres Variation", 10],
    // Open games: alternative defenses and common third/fourth-move choices.
    ['C67', 'Ruy Lopez: Berlin Defense, Berlin Wall', 8],
    ['C68', 'Ruy Lopez: Exchange Variation, Alekhine Variation', 4],
    ['C80', 'Ruy Lopez: Open, Bernstein Variation', 4],
    ['C55', 'Italian Game: Two Knights Defense', 6],
    ['C47', 'Four Knights Game: Scotch Variation Accepted, Main Line', 5],
    ['C48', 'Four Knights Game: Spanish Variation, Rubinstein Variation, Maróczy Variation', 3],
    ['C86', 'Ruy Lopez: Closed, Worrall Attack, Castling Line', 3],
    ['C45', 'Scotch Game: Gottschall Variation', 3],
    // Sicilian: cover anti-Sicilians and several sound Open Sicilian systems.
    ['B22', 'Sicilian Defense: Alapin Variation, Barmen Defense, Endgame Variation', 5],
    ['B25', 'Sicilian Defense: Closed, Botvinnik Defense, Edge Variation', 4],
    ['B41', 'Sicilian Defense: Kan Variation, Maróczy Bind, Bronstein Variation', 4],
    ['B44', 'Sicilian Defense: Taimanov Variation, Modern Line', 5],
    ['B83', 'Sicilian Defense: Scheveningen Variation, Modern Variation', 4],
    ['B63', 'Sicilian Defense: Richter-Rauzer Variation, Classical Variation', 5],
    // Other e4 defenses; shorter source lines stop without fabricated continuations.
    ['C02', 'French Defense: Advance Variation, Euwe Variation', 6, 10],
    ['C01', 'French Defense: Exchange Variation, Bogoljubow Variation', 5, 10],
    ['C06', 'French Defense: Tarrasch Variation, Closed Variation, Main Line', 5],
    ['C18', 'French Defense: Winawer Variation, Advance Variation, with Bd3', 4],
    ['B12', 'Caro-Kann Defense: Advance Variation, Short Variation', 6, 7],
    ['B14', 'Caro-Kann Defense: Panov Attack', 4],
    ['B08', 'Pirc Defense: Classical Variation, Quiet System, Chigorin Line', 4, 12],
    ['B01', 'Scandinavian Defense: Schiller-Pytel Variation, Modern Variation', 3],
    ['B03', 'Alekhine Defense: Exchange Variation, Karpov Variation', 3],
    // d4: accepted/exchange structures, flank defenses, and a London setup.
    ['D27', "Queen's Gambit Accepted: Furman Variation", 6],
    ['D14', 'Slav Defense: Exchange Variation, Trifunovic Variation', 5],
    ['D47', 'Semi-Slav Defense: Meran Variation', 6],
    ['D35', "Queen's Gambit Declined: Exchange Variation", 6],
    ['E08', 'Catalan Opening: Closed', 6],
    ['E14', "Queen's Indian Defense: Averbakh Variation", 5],
    ['E16', "Queen's Indian Defense: Capablanca Variation", 5],
    ['D85', 'Grünfeld Defense: Exchange Variation, Modern Exchange Variation', 6],
    ['D02', "Queen's Pawn Game: London System", 6, 11],
    // Flank openings: add independent responses to c4 and Nf3.
    ['A37', 'English Opening: Symmetrical Variation, Botvinnik System Reversed, with Nf3', 6],
    ['A30', 'English Opening: Symmetrical, Hedgehog, Flexible Formation', 4],
    ['A15', "English Opening: Anglo-Indian Defense, King's Indian Formation, Double Fianchetto", 4, 8],
    ['A05', "King's Indian Attack: Wahls Defense", 6, 10],
];
const { parseFen } = load('../utils/fen_parcer');
const { createCastlingState, createStandardState } = load('../utils/types');
const { legalMovesForPiece } = load('rules');
const { makeMove } = load('apply_move');
const { pieceColor, pieceIds } = load('../utils/pieces');
const tokens = pgn => pgn.split(/\s+/).filter(token => !/^\d+\./.test(token));
const directory = process.argv[2];
if (!directory) throw new Error('Pass the directory containing the pinned Lichess TSV files.');
const rows = ['a', 'b', 'c', 'd', 'e'].flatMap(file => fs.readFileSync(path.join(directory, `${file}.tsv`), 'utf8').trim().split('\n').slice(1).map(row => {
    const [eco, name, pgn] = row.split('\t');
    return { eco, name, pgn };
}));
function convert(pgn) {
    const board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    const castling = createCastlingState(), standard = createStandardState();
    let turn = 'white';
    return tokens(pgn).map(san => {
        const moves = board.flatMap((piece, from) => pieceColor(piece) === turn ? legalMovesForPiece(board, from, castling, standard) : []);
        const clean = san.replace(/[+#?!]+$/g, '');
        const candidates = moves.filter(move => {
            if (clean === 'O-O' || clean === 'O-O-O') return move.kind === 'castle' && (move.to > move.from) === (clean === 'O-O');
            const match = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(clean);
            if (!match || move.kind === 'rotate' || move.kind === 'castle') return false;
            const [, symbol, file, rank, capture, target, promotion] = match;
            const names = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
            return Math.abs(board[move.from]) === pieceIds[names[symbol] ?? 'pawn']
                && (file === undefined || move.from % 8 === 'abcdefgh'.indexOf(file))
                && (rank === undefined || 8 - Math.floor(move.from / 8) === Number(rank))
                && move.to === (8 - Number(target[1])) * 8 + 'abcdefgh'.indexOf(target[0])
                && Boolean(capture) === (board[move.to] !== 0 || move.kind === 'en-passant')
                && (promotion ? move.promotion === names[promotion] : !move.promotion);
        });
        if (candidates.length !== 1) throw new Error(`Ambiguous/illegal SAN: ${san} in ${pgn}`);
        const move = candidates[0], result = uci(move);
        makeMove(board, move, castling, standard);
        turn = turn === 'white' ? 'black' : 'white';
        return result;
    }).slice(0, 14).join(' ');
}
const lines = selections.map(([eco, name, weight, minimumPlies = 14]) => {
    const row = rows.find(row => row.eco === eco && row.name === name && tokens(row.pgn).length >= minimumPlies);
    if (!row) throw new Error(`Missing selected line: ${eco} ${name}`);
    return { ...row, weight, moves: convert(row.pgn) };
});
// Different names can truncate to the same repertoire: reject inflated line counts.
if (lines.length !== 50) throw new Error(`Expected 50 selections, received ${lines.length}.`);
if (new Set(lines.map(line => line.moves)).size !== lines.length) throw new Error('Selected lines duplicate a truncated move sequence.');
fs.writeFileSync(new URL('../src/components/common/opening_book_data.ts', import.meta.url),
    `// Generated by scripts/import-opening-book.js from lichess-org/chess-openings (CC0).\n// Source revision: ${SOURCE_REVISION}\n// Weights are application preferences, not Lichess game frequencies.\nexport const openingLines = ${JSON.stringify(lines, null, 4)} as const;\n`);
console.log(`Imported ${lines.length} Lichess opening lines, capped at 14 plies.`);
