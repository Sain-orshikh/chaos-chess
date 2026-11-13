import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {load,position} from './engine-tools.mjs';
import {loadPosition} from '../public/engines/merlin-client.js';
const {default:create}=await import(pathToFileURL(path.resolve(process.argv[2]??'public/engines/merlin.js')));
const engine=await create();engine._merlin_init();
const {legalMovesForPiece}=load('rules'),{makeMove}=load('apply_move'),{saveUndoInformation,unmakeMove}=load('legal_move');
const val={0:0,1:100,2:320,3:330,4:500,6:900,7:0};
const promotions={knight:2,bishop:3,rook:4,queen:6};
const value=p=>val[Math.abs(p)];
function moves(req){return req.board.flatMap((p,i)=>p&&(p>0)===(req.turn==='white')?legalMovesForPiece(req.board,i,req.castling,req.standard):[]);}
function withMove(req,m,fn){const undo=saveUndoInformation(req.board,m,req.castling,req.standard),turn=req.turn;makeMove(req.board,m,req.castling,req.standard);req.turn=turn==='white'?'black':'white';try{return fn();}finally{req.turn=turn;unmakeMove(req.board,m,undo,req.castling,req.standard);}}
function gain(req,m){return value(req.board[m.kind==='en-passant'?m.capturedSquare:m.to])+(m.promotion?val[promotions[m.promotion]]-100:0);}
// Independent oracle: actual app legal-move generation and full make/unmake.
// Pick the least valuable legal recapturer, breaking equal-value ties by square.
function tail(req,target){
 const candidates=moves(req).filter(m=>m.to===target&&m.kind==='c').sort((a,b)=>(Math.abs(req.board[a.from])===7?1e9:value(req.board[a.from]))-(Math.abs(req.board[b.from])===7?1e9:value(req.board[b.from]))||a.from-b.from||(val[promotions[b.promotion]]??0)-(val[promotions[a.promotion]]??0));
 if(!candidates.length)return 0;
 const m=candidates[0],g=gain(req,m);
 return Math.max(0,g-withMove(req,m,()=>tail(req,target)));
}
function oracle(req,m){const g=gain(req,m);return g-withMove(req,m,()=>tail(req,m.to));}
function packed(m){return m.from|(m.to<<6)|((promotions[m.promotion]??0)<<12)|(({m:0,c:1,'en-passant':5}[m.kind])<<15);}
function board(pieces,turn='white'){const req=position('7k/8/8/8/8/8/8/K7 w - - 0 1');req.board.fill(0);for(const [sq,p] of pieces)req.board[sq]=p;req.turn=turn;return req;}
let checked=0;
function check(req,m,expected){const before=JSON.stringify(req),wanted=oracle(req,m);assert.equal(JSON.stringify(req),before);if(expected!==undefined)assert.equal(wanted,expected);loadPosition(engine,req);const actual=engine._merlin_see(packed(m));assert.equal(engine._merlin_moves(),moves(req).length);assert.equal(actual,wanted,JSON.stringify({board:req.board,move:m,wanted,actual}));assert.equal(JSON.stringify(req),before);checked++;}
const capture=(from,to)=>({from,to,kind:'c'});
check(board([[56,7],[7,-7],[35,6],[28,-1]]),capture(35,28),100);
check(board([[56,7],[7,-7],[35,6],[28,-1],[42,-3]]),capture(35,28),-800);
check(board([[56,7],[7,-7],[35,1],[28,-6],[42,-3]]),capture(35,28),800);
check(board([[56,7],[7,-7],[36,4],[28,-1],[19,-1],[37,1]]),capture(36,28),-300);
check(board([[56,7],[4,-7],[60,4],[19,6],[11,-1],[12,-4],[38,3]]),capture(19,11),100);
check(board([[56,7],[20,-7],[36,4],[28,-1],[37,1]]),capture(36,28),100);
check(board([[56,7],[20,-7],[36,4],[28,-1]]),capture(36,28),-400);
for(const fen of ['4k3/P7/8/3pP3/8/8/8/4K3 w - d6 0 1','4k3/8/8/8/8/8/p7/4K3 b - - 0 1','r6k/1P6/8/8/8/8/8/4K3 w - - 0 1','7k/8/8/3pP3/8/8/8/K2r4 w - d6 0 1']){const req=position(fen);for(const m of moves(req).filter(m=>m.kind==='c'||m.kind==='en-passant'||m.promotion))check(req,m);}
// Also verify a pawn recapturing on the promotion rank mid-exchange.
check(board([[63,7],[7,-7],[57,4],[56,-3],[49,-1]]),capture(57,56),-970);
let seed=20261113;
for(let game=0;game<5;game++){
 const req=position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
 for(let ply=0;ply<90;ply++){
  const legal=moves(req);for(const m of legal.filter(m=>m.kind==='c'||m.kind==='en-passant'||m.promotion))check(req,m);
  if(!legal.length)break;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const m=legal[seed%legal.length];makeMove(req.board,m,req.castling,req.standard);req.turn=req.turn==='white'?'black':'white';
 }
}
console.log(`SEE: ${checked} captures/promotions matched the independent legal exchange oracle, including x-rays, pins, king captures, en passant and promotions.`);
