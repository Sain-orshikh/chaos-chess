import fs from 'node:fs';
import ts from 'typescript';
const modules = new Map();
export function load(name, base = new URL('../src/components/common/', import.meta.url)) {
    const url = new URL(`${name}.ts`, base);
    if (modules.has(url.href)) return modules.get(url.href).exports;
    const m = { exports: {} }; modules.set(url.href, m);
    new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(url, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(id => load(id, new URL('.', url)), m, m.exports);
    return m.exports;
}
export const {parseFen,standardStateFromFen} = load('../utils/fen_parcer');
export const uci = m => m ? `${'abcdefgh'[m.from % 8]}${8-Math.floor(m.from/8)}${'abcdefgh'[m.to % 8]}${8-Math.floor(m.to/8)}${m.promotion ? {queen:'q',rook:'r',bishop:'b',knight:'n'}[m.promotion] : ''}` : null;
export function position(fen,normal=true){return {board:parseFen(fen),turn:fen.split(' ')[1]==='b'?'black':'white',standard:normal?standardStateFromFen(fen):undefined,castling:{white:false,black:false},halfmoveClock:Number(fen.split(' ')[4])||0};}
