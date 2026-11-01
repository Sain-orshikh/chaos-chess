import type { Board, Color } from "./types";

interface ZobristTable {
    pieces: bigint[][];
    white_to_move: bigint;
    white_castle: bigint;
    black_castle: bigint;
}

type HashValue = bigint;

function randomBits64(): HashValue {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const binaryString = [...bytes].map(b => b.toString(2).padStart(8, '0')).join('');
  return BigInt('0b' + binaryString);
}

function zobrist_init(): ZobristTable {
    return {
        pieces: Array.from({ length: 64 }, () => Array.from({ length: 14 }, () => randomBits64())),
        white_to_move: randomBits64(),
        white_castle: randomBits64(),
        black_castle: randomBits64(),
    };
}

// Every position in this module instance uses the same random keys.
const table = zobrist_init();

export function zobrist_hash(board: Board, castleWhite: boolean, castleBlack: boolean, turn: Color): HashValue{

    let h: HashValue = BigInt(0);

    if (turn === "white"){
        h ^= table.white_to_move;
    }
    if (castleWhite){
        h ^= table.white_castle;
    }
    if (castleBlack){
        h ^= table.black_castle;
    }
        
    for (let i=0; i<=63; i++){
        if (board[i] !== 0){
            const piece = board[i];
            const slot = piece > 0 ? piece - 1 : 7 + (-piece - 1);
            h ^= table.pieces[i][slot];
        }
    }
    return h
}
