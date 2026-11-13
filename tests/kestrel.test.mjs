import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import createKestrel from '../public/engines/kestrel.js';
import {loadPosition,decodeMove,searchPosition} from '../public/engines/kestrel-client.js';
const cache=new Map();
function load(name,base=new URL('../src/components/common/',import.meta.url)){
 const url=new URL(`${name}.ts`,base);if(cache.has(url.href))return cache.get(url.href).exports;
 const m={exports:{}};cache.set(url.href,m);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(id=>load(id,new URL('.',url)),m,m.exports);return m.exports;
}
const {parseFen,standardStateFromFen}=load('../utils/fen_parcer');
const {legalMovesForPiece}=load('rules');const {makeMove}=load('apply_move');
const engine=await createKestrel();engine._kestrel_init();
const start='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function request(fen,normal=true){return {board:parseFen(fen),turn:fen.split(' ')[1]==='w'?'white':'black',standard:normal?standardStateFromFen(fen):undefined,castling:{white:false,black:false},halfmoveClock:Number(fen.split(' ')[4])||0};}
const key=m=>JSON.stringify(Object.fromEntries(Object.entries(m).sort()));
function legal(req){loadPosition(engine,req);const n=engine._kestrel_moves();return Array.from(new Int32Array(engine.HEAP32.buffer,engine._kestrel_input(),n),m=>decodeMove(m,req.board));}
function compare(req){const actual=legal(req),expected=req.board.flatMap((p,i)=>p&&(p>0)===(req.turn==='white')?legalMovesForPiece(req.board,i,req.castling,req.standard):[]);assert.deepEqual(actual.map(key).sort(),expected.map(key).sort());return actual;}
const perfts=[20,400,8902,197281];for(let d=1;d<=4;d++){loadPosition(engine,request(start));assert.equal(engine._kestrel_perft(d),perfts[d-1]);}
loadPosition(engine,request('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'));assert.equal(engine._kestrel_perft(3),97862);
for(const fen of [start,'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1','4k3/P7/8/3pP3/8/8/8/4K3 w - d6 0 1','4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'])compare(request(fen));
// Deterministic random walks exercise legality parity for both variants and make/unmake.
let seed=7103;for(const normal of [true,false])for(let game=0;game<10;game++){const req=request(start,normal);for(let ply=0;ply<120;ply++){const moves=compare(req);if(!moves.length)break;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const m=moves[seed%moves.length];makeMove(req.board,m,req.castling,req.standard);req.turn=req.turn==='white'?'black':'white';}}
const req=request('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');const result=searchPosition(engine,{...req,timeMs:100,maxDepth:8});assert.ok(compare(req).some(m=>key(m)===key(result.move)));assert.ok(result.score>999900);assert.ok(result.elapsedMs<250);
const timeoutReq=request(start);const before=JSON.stringify(timeoutReq);const timed=searchPosition(engine,{...timeoutReq,timeMs:100});assert.ok(timed.depth>0);assert.ok(timed.elapsedMs<250);assert.equal(JSON.stringify(timeoutReq),before);compare(timeoutReq);
console.log('Kestrel: Classic perft through depth 4; 2,400 random Classic/Havoc positions; special moves; mate; timeout/restoration passed.');
