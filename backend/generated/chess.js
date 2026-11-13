// src/components/utils/pieces.ts
var promotionPieces = ["queen", "rook", "bishop", "knight"];
var pieceDefinitions = {
  pawn: { id: 1, value: 100, normalValue: 100, label: "pawn", image: "pawn", fen: "p", movement: { pawn: true }, normal_move: { normal_pawn: true } },
  knight: { id: 2, value: 400, normalValue: 320, label: "knight", image: "knight", fen: "n", movement: { straight: 2, diagonal: 2 }, normal_move: { horse: true } },
  bishop: { id: 3, value: 200, normalValue: 330, label: "bishop", image: "bishop", fen: "b", movement: { checkers: true }, normal_move: { diagonal: 7 } },
  rook: { id: 4, value: 500, normalValue: 500, label: "rook", image: "rook", fen: "r", movement: { straight: 7 }, rotatesTo: "diagonalrook", normal_move: { straight: 7 } },
  diagonalrook: { id: 5, value: 500, normalValue: 500, label: "diagonal rook", image: "rook-diagonal", fen: "d", movement: { diagonal: 7 }, rotatesTo: "rook", normal_move: { diagonal: 7 } },
  queen: { id: 6, value: 800, normalValue: 900, label: "queen", image: "queen", fen: "q", movement: { straight: 7, horse: true }, normal_move: { straight: 7, diagonal: 7 } },
  // Kings cannot be captured; checkmate is scored separately from material.
  king: { id: 7, value: 0, normalValue: 0, label: "king", image: "king", fen: "k", movement: { straight: 1, diagonal: 1, castle: true }, normal_move: { straight: 1, diagonal: 1, castle: true } }
};
var names = Object.keys(pieceDefinitions);
var pieceIds = Object.fromEntries(names.map((name) => [name, pieceDefinitions[name].id]));
var pieceNames = Object.fromEntries(names.flatMap((name) => {
  const fen = pieceDefinitions[name].fen;
  return fen ? [[fen, name]] : [];
}));
var namesById = Object.fromEntries(names.map((name) => [pieceDefinitions[name].id, name]));
var definitionsById = Object.fromEntries(names.map((name) => [pieceDefinitions[name].id, pieceDefinitions[name]]));
function pieceColor(piece) {
  return piece === 0 ? null : piece > 0 ? "white" : "black";
}
function pieceDefinition(piece) {
  return definitionsById[Math.abs(piece)];
}
function makePiece(name, color) {
  return pieceIds[name] * (color === "white" ? 1 : -1);
}
var straightDirections = [[-1, 0], [1, 0], [0, -1], [0, 1]];
var diagonalDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
var horseSteps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

// src/components/utils/types.ts
function createStandardState() {
  return { castlingRights: { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } }, enPassantTarget: null };
}
function cloneStandardState(state) {
  return { castlingRights: { white: { ...state.castlingRights.white }, black: { ...state.castlingRights.black } }, enPassantTarget: state.enPassantTarget };
}
function createCastlingState() {
  return { white: false, black: false };
}
var offsetsS = [-8, 8, -1, 1];
var offsetsD = [-9, -7, 7, 9];

// src/components/common/apply_move.ts
function updateStandardState(board, move, state) {
  const piece = board[move.from];
  const color = pieceColor(piece);
  if (Math.abs(piece) === pieceIds.king) {
    state.castlingRights[color].kingSide = false;
    state.castlingRights[color].queenSide = false;
  }
  for (const side of ["white", "black"]) {
    const home = side === "white" ? 60 : 4;
    for (const [square, right] of [[home + 3, "kingSide"], [home - 4, "queenSide"]]) {
      if (move.from === square && piece === makePiece("rook", side) || move.to === square && board[square] === makePiece("rook", side)) state.castlingRights[side][right] = false;
    }
  }
  state.enPassantTarget = Math.abs(piece) === pieceIds.pawn && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : null;
}
function makeMove(board, move, castling = createCastlingState(), standard) {
  const piece = board[move.from];
  if (!piece) throw new Error("Cannot move an empty square");
  if (move.kind === "rotate") {
    if (standard) throw new Error("Standard pieces cannot rotate");
    if (pieceDefinition(piece)?.rotatesTo !== move.piece) {
      throw new Error("Invalid piece rotation");
    }
    board[move.from] = makePiece(move.piece, pieceColor(piece));
    return board;
  }
  const color = pieceColor(piece);
  if (move.kind === "castle") {
    const home = color === "white" ? 60 : 4;
    const kingSide = move.to === home + 2;
    const rookFrom = home + (kingSide ? 3 : -4);
    const rookTo = home + (kingSide ? 1 : -1);
    if (piece !== makePiece("king", color) || move.from !== home || !kingSide && move.to !== home - 2 || move.rookFrom !== rookFrom || move.rookTo !== rookTo || board[rookFrom] !== makePiece("rook", color) || castling[color]) throw new Error("Invalid castle");
    for (let square = Math.min(home, rookFrom) + 1; square < Math.max(home, rookFrom); square++) {
      if (board[square] !== 0) throw new Error("Castling path is blocked");
    }
    if (standard) {
      if (!standard.castlingRights[color][kingSide ? "kingSide" : "queenSide"]) throw new Error("Castling right has been lost");
      updateStandardState(board, move, standard);
    }
    board[move.from] = 0;
    board[move.to] = piece;
    board[rookFrom] = 0;
    board[rookTo] = makePiece("rook", color);
    castling[color] = true;
    return board;
  }
  const promotes = Math.abs(piece) === pieceIds.pawn && Math.floor(move.to / 8) === (color === "white" ? 0 : 7);
  if (promotes !== Boolean(move.promotion) || move.promotion && !promotionPieces.includes(move.promotion)) {
    throw new Error("A promotion move must specify a valid promotion piece");
  }
  if (move.kind === "en-passant") {
    const forward = color === "white" ? -8 : 8;
    if (!standard || Math.abs(piece) !== pieceIds.pawn || standard.enPassantTarget !== move.to || board[move.to] !== 0 || move.capturedSquare !== move.to - forward || Math.floor(move.from / 8) !== (color === "white" ? 3 : 4) || Math.floor(move.to / 8) !== Math.floor(move.from / 8) + forward / 8 || Math.abs(move.from % 8 - move.to % 8) !== 1 || board[move.capturedSquare] !== makePiece("pawn", color === "white" ? "black" : "white")) throw new Error("Invalid en passant");
  }
  if (standard) updateStandardState(board, move, standard);
  if (move.kind === "en-passant") board[move.capturedSquare] = 0;
  if (move.kind === "ch") {
    board[(move.from + move.to) / 2] = 0;
  }
  board[move.from] = 0;
  board[move.to] = move.promotion ? makePiece(move.promotion, color) : piece;
  return board;
}
function applyMove(board, move, castling = createCastlingState(), standard) {
  const nextBoard = board.slice();
  makeMove(nextBoard, move, castling, standard);
  return nextBoard;
}

// src/components/utils/king_safety.ts
function onBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}
function findKing(board, id) {
  return board.indexOf(id);
}
function isKingSafe(board, color, kingPos = findKing(board, makePiece("king", color))) {
  if (!Number.isInteger(kingPos) || kingPos < 0 || kingPos >= 64) return false;
  const kingRow = Math.floor(kingPos / 8);
  const kingCol = kingPos % 8;
  if (board[kingPos] !== makePiece("king", color)) return false;
  const enemy = color === "white" ? "black" : "white";
  function enemyMovement(row, col) {
    if (!onBoard(row, col)) return void 0;
    const piece = board[row * 8 + col];
    return pieceColor(piece) === enemy ? pieceDefinition(piece)?.movement : void 0;
  }
  for (const [dr, dc] of horseSteps) {
    if (enemyMovement(kingRow + dr, kingCol + dc)?.horse) return false;
  }
  const enemyForward = enemy === "white" ? -1 : 1;
  if (enemyMovement(kingRow - enemyForward, kingCol)?.pawn) return false;
  for (const [dr, dc] of diagonalDirections) {
    const landingRow = kingRow - dr;
    const landingCol = kingCol - dc;
    if (enemyMovement(kingRow + dr, kingCol + dc)?.checkers && onBoard(landingRow, landingCol) && board[landingRow * 8 + landingCol] === 0) return false;
  }
  for (const [directions, kind] of [[straightDirections, "straight"], [diagonalDirections, "diagonal"]]) {
    for (const [dr, dc] of directions) {
      for (let distance = 1; distance <= 7; distance++) {
        const row = kingRow + dr * distance;
        const col = kingCol + dc * distance;
        if (!onBoard(row, col)) break;
        if (board[row * 8 + col] === 0) continue;
        if ((enemyMovement(row, col)?.[kind] ?? 0) >= distance) return false;
        break;
      }
    }
  }
  return true;
}

// src/components/common/legal_move.ts
function saveUndoInformation(board, move, castling = createCastlingState(), standard) {
  return {
    movingPiece: board[move.from],
    capturedPiece: board[move.to],
    jumpedPiece: move.kind === "ch" ? board[(move.from + move.to) / 2] : 0,
    ...standard ? { standard: cloneStandardState(standard) } : {},
    ...move.kind === "en-passant" ? { enPassantPiece: board[move.capturedSquare] } : {},
    ...move.kind === "castle" ? { castle: { rookFromPiece: board[move.rookFrom], rookToPiece: board[move.rookTo], castling: { ...castling } } } : {}
  };
}
function unmakeMove(board, move, undo, castling = createCastlingState(), standard) {
  board[move.from] = undo.movingPiece;
  board[move.to] = undo.capturedPiece;
  if (move.kind === "ch") board[(move.from + move.to) / 2] = undo.jumpedPiece;
  if (move.kind === "en-passant") board[move.capturedSquare] = undo.enPassantPiece;
  if (standard && undo.standard) Object.assign(standard, cloneStandardState(undo.standard));
  if (move.kind === "castle" && undo.castle) {
    board[move.rookFrom] = undo.castle.rookFromPiece;
    board[move.rookTo] = undo.castle.rookToPiece;
    Object.assign(castling, undo.castle.castling);
  }
}
function LegalMoveGenerate(board, from, castling = createCastlingState()) {
  const row = Math.floor(from / 8);
  const col = from % 8;
  const piece = board[from];
  const moves = [];
  if (!piece) return moves;
  const color = pieceColor(piece);
  const kingId = pieceIds.king * (color === "white" ? 1 : -1);
  const rookId = pieceIds.rook * (color === "white" ? 1 : -1);
  const kingPos = findKing(board, kingId);
  const kingOrigin = color === "white" ? 60 : 4;
  if (kingPos === -1) return moves;
  const enemyKingPos = findKing(board, -kingId);
  const definition = pieceDefinition(piece);
  if (!definition) throw new Error(`Unknown piece code: ${piece}`);
  const origin = from;
  function genStraight(range) {
    const to_wall = [row, 7 - row, col, 7 - col];
    for (let direction = 0; direction < 4; direction++) {
      const limit = Math.min(range, to_wall[direction]);
      for (let step = 1; step <= limit; step++) {
        const to = origin + offsetsS[direction] * step;
        const target = board[to];
        if (target !== 0) {
          const targetColor = pieceColor(target);
          if (targetColor !== color) {
            moves.push({ from: origin, to, kind: "c" });
          }
          break;
        }
        moves.push({ from: origin, to, kind: "m" });
      }
    }
  }
  function genDiagonal(range) {
    const diagonalWalls = [
      Math.min(row, col),
      // Northwest
      Math.min(row, 7 - col),
      // Northeast
      Math.min(7 - row, col),
      // Southwest
      Math.min(7 - row, 7 - col)
      // Southeast
    ];
    for (let direction = 0; direction < 4; direction++) {
      const limit = Math.min(range, diagonalWalls[direction]);
      for (let step = 1; step <= limit; step++) {
        const to = origin + offsetsD[direction] * step;
        const target = board[to];
        if (target !== 0) {
          const targetColor = pieceColor(target);
          if (targetColor !== color) {
            moves.push({ from: origin, to, kind: "c" });
          }
          break;
        }
        moves.push({ from: origin, to, kind: "m" });
      }
    }
  }
  function genHorse() {
    for (const [dr, dc] of horseSteps) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow >= 8 || nextCol < 0 || nextCol >= 8) {
        continue;
      }
      const target = board[nextRow * 8 + nextCol];
      if (target !== 0 && pieceColor(target) === color) {
        continue;
      }
      moves.push({ from: origin, to: nextRow * 8 + nextCol, kind: target === 0 ? "m" : "c" });
    }
  }
  function genCheckers() {
    function onBoard3(r, c) {
      return r >= 0 && r < 8 && c >= 0 && c < 8;
    }
    for (const [dr, dc] of diagonalDirections) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (!onBoard3(nextRow, nextCol)) continue;
      const target = board[nextRow * 8 + nextCol];
      if (target === 0) {
        moves.push({
          from: origin,
          to: nextRow * 8 + nextCol,
          kind: "m"
        });
        continue;
      }
      const landingRow = row + dr * 2;
      const landingCol = col + dc * 2;
      if (!onBoard3(landingRow, landingCol)) continue;
      if (board[landingRow * 8 + landingCol] !== 0) continue;
      moves.push({
        from: origin,
        to: landingRow * 8 + landingCol,
        // Friendly jumps are quiet moves; only enemies are removed.
        kind: pieceColor(target) === color ? "m" : "ch"
      });
    }
  }
  function genPawn() {
    const forward = color === "white" ? -1 : 1;
    const nextRow = row + forward;
    if (nextRow < 0 || nextRow >= 8) return;
    for (const dc of [-1, 1]) {
      const nextCol = col + dc;
      if (nextCol < 0 || nextCol >= 8) continue;
      if (board[nextRow * 8 + nextCol] === 0) {
        moves.push({
          from: origin,
          to: nextRow * 8 + nextCol,
          kind: "m"
        });
      }
    }
    const target = board[nextRow * 8 + col];
    if (target !== 0 && pieceColor(target) !== color) {
      moves.push({
        from: origin,
        to: nextRow * 8 + col,
        kind: "c"
      });
    }
  }
  function genCastle() {
    if (origin !== kingOrigin || castling[color] || !isKingSafe(board, color, kingPos)) return;
    for (const [direction, distance] of [[1, 3], [-1, 4]]) {
      const rookFrom = origin + direction * distance;
      if (board[rookFrom] !== rookId) continue;
      let clear = true;
      for (let step = 1; step < distance; step++) {
        if (board[origin + direction * step] !== 0) {
          clear = false;
          break;
        }
      }
      if (clear) moves.push({ from: origin, to: origin + direction * 2, kind: "castle", rookFrom, rookTo: origin + direction });
    }
  }
  const movement = definition.movement;
  if (movement.straight) genStraight(movement.straight);
  if (movement.diagonal) genDiagonal(movement.diagonal);
  if (movement.horse) genHorse();
  if (movement.checkers) genCheckers();
  if (movement.pawn) genPawn();
  if (definition.rotatesTo) {
    moves.push({ from: origin, to: origin, kind: "rotate", piece: definition.rotatesTo });
  }
  if (movement.castle) genCastle();
  const candidates = Math.abs(piece) === pieceIds.pawn ? moves.flatMap((move) => {
    if (move.kind !== "rotate" && move.kind !== "castle" && move.kind !== "en-passant" && Math.floor(move.to / 8) === (color === "white" ? 0 : 7)) {
      return promotionPieces.map((promotion) => ({ ...move, promotion }));
    }
    return [move];
  }) : moves;
  return candidates.filter((move) => {
    const toRow = Math.floor(move.to / 8);
    const toCol = move.to % 8;
    if (move.kind !== "rotate") {
      if (move.to === enemyKingPos) return false;
      if (move.kind === "ch") {
        const capturedRow = (row + toRow) / 2;
        const capturedCol = (col + toCol) / 2;
        if (capturedRow * 8 + capturedCol === enemyKingPos) return false;
      }
    }
    const undo = saveUndoInformation(board, move, castling);
    const nextKingPos = piece === kingId ? move.to : kingPos;
    makeMove(board, move, castling);
    try {
      return isKingSafe(board, color, nextKingPos);
    } finally {
      unmakeMove(board, move, undo, castling);
    }
  });
}

// src/components/common/normal/normal_king_safety.ts
function onBoard2(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}
function findKing2(board, id) {
  return board.indexOf(id);
}
function isKingSafe2(board, color, kingPos = findKing2(board, makePiece("king", color))) {
  if (!Number.isInteger(kingPos) || kingPos < 0 || kingPos >= 64) return false;
  const kingRow = Math.floor(kingPos / 8);
  const kingCol = kingPos % 8;
  if (board[kingPos] !== makePiece("king", color)) return false;
  const enemy = color === "white" ? "black" : "white";
  function enemyMovement(row, col) {
    if (!onBoard2(row, col)) return void 0;
    const piece = board[row * 8 + col];
    return pieceColor(piece) === enemy ? pieceDefinition(piece)?.normal_move : void 0;
  }
  for (const [dr, dc] of horseSteps) {
    if (enemyMovement(kingRow + dr, kingCol + dc)?.horse) return false;
  }
  const enemyForward = enemy === "white" ? -1 : 1;
  for (const dc of [-1, 1]) {
    if (enemyMovement(kingRow - enemyForward, kingCol + dc)?.normal_pawn) return false;
  }
  for (const [directions, kind] of [[straightDirections, "straight"], [diagonalDirections, "diagonal"]]) {
    for (const [dr, dc] of directions) {
      for (let distance = 1; distance <= 7; distance++) {
        const row = kingRow + dr * distance;
        const col = kingCol + dc * distance;
        if (!onBoard2(row, col)) break;
        if (board[row * 8 + col] === 0) continue;
        if ((enemyMovement(row, col)?.[kind] ?? 0) >= distance) return false;
        break;
      }
    }
  }
  return true;
}

// src/components/common/normal/normal_legal_move.ts
function LegalMoveGenerate2(board, from, castling = createCastlingState(), standard = createStandardState()) {
  const row = Math.floor(from / 8);
  const col = from % 8;
  const piece = board[from];
  const moves = [];
  if (!piece) return moves;
  const color = pieceColor(piece);
  const kingId = pieceIds.king * (color === "white" ? 1 : -1);
  const rookId = pieceIds.rook * (color === "white" ? 1 : -1);
  const kingPos = findKing2(board, kingId);
  const kingOrigin = color === "white" ? 60 : 4;
  if (kingPos === -1) return moves;
  const enemyKingPos = findKing2(board, -kingId);
  const definition = pieceDefinition(piece);
  if (!definition) throw new Error(`Unknown piece code: ${piece}`);
  const origin = from;
  function genStraight(range) {
    const to_wall = [row, 7 - row, col, 7 - col];
    for (let direction = 0; direction < 4; direction++) {
      const limit = Math.min(range, to_wall[direction]);
      for (let step = 1; step <= limit; step++) {
        const to = origin + offsetsS[direction] * step;
        const target = board[to];
        if (target !== 0) {
          const targetColor = pieceColor(target);
          if (targetColor !== color) {
            moves.push({ from: origin, to, kind: "c" });
          }
          break;
        }
        moves.push({ from: origin, to, kind: "m" });
      }
    }
  }
  function genDiagonal(range) {
    const diagonalWalls = [
      Math.min(row, col),
      // Northwest
      Math.min(row, 7 - col),
      // Northeast
      Math.min(7 - row, col),
      // Southwest
      Math.min(7 - row, 7 - col)
      // Southeast
    ];
    for (let direction = 0; direction < 4; direction++) {
      const limit = Math.min(range, diagonalWalls[direction]);
      for (let step = 1; step <= limit; step++) {
        const to = origin + offsetsD[direction] * step;
        const target = board[to];
        if (target !== 0) {
          const targetColor = pieceColor(target);
          if (targetColor !== color) {
            moves.push({ from: origin, to, kind: "c" });
          }
          break;
        }
        moves.push({ from: origin, to, kind: "m" });
      }
    }
  }
  function genHorse() {
    for (const [dr, dc] of horseSteps) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow >= 8 || nextCol < 0 || nextCol >= 8) {
        continue;
      }
      const target = board[nextRow * 8 + nextCol];
      if (target !== 0 && pieceColor(target) === color) {
        continue;
      }
      moves.push({ from: origin, to: nextRow * 8 + nextCol, kind: target === 0 ? "m" : "c" });
    }
  }
  function genNormalPawn() {
    const forward = color === "white" ? -1 : 1;
    const nextRow = row + forward;
    if (nextRow < 0 || nextRow >= 8) return;
    if (board[nextRow * 8 + col] === 0) {
      moves.push({ from: origin, to: nextRow * 8 + col, kind: "m" });
      const startingRow = color === "white" ? 6 : 1;
      const doubleRow = row + 2 * forward;
      if (row === startingRow && board[doubleRow * 8 + col] === 0) {
        moves.push({ from: origin, to: doubleRow * 8 + col, kind: "m" });
      }
    }
    for (const dc of [-1, 1]) {
      const nextCol = col + dc;
      if (nextCol < 0 || nextCol >= 8) continue;
      const target = board[nextRow * 8 + nextCol];
      if (target !== 0 && pieceColor(target) !== color) {
        moves.push({
          from: origin,
          to: nextRow * 8 + nextCol,
          kind: "c"
        });
      } else if (standard.enPassantTarget === nextRow * 8 + nextCol && target === 0 && row === (color === "white" ? 3 : 4) && board[row * 8 + nextCol] === -piece) {
        moves.push({ from: origin, to: nextRow * 8 + nextCol, kind: "en-passant", capturedSquare: row * 8 + nextCol });
      }
    }
  }
  function genCastle() {
    if (origin !== kingOrigin || castling[color] || !isKingSafe2(board, color, kingPos)) return;
    for (const [direction, distance] of [[1, 3], [-1, 4]]) {
      if (!standard.castlingRights[color][direction === 1 ? "kingSide" : "queenSide"]) continue;
      const rookFrom = origin + direction * distance;
      if (board[rookFrom] !== rookId) continue;
      let clear = true;
      for (let step = 1; step < distance; step++) {
        if (board[origin + direction * step] !== 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const crossing = origin + direction;
      board[origin] = 0;
      board[crossing] = kingId;
      let crossingSafe;
      try {
        crossingSafe = isKingSafe2(board, color, crossing);
      } finally {
        board[origin] = kingId;
        board[crossing] = 0;
      }
      if (crossingSafe) moves.push({ from: origin, to: origin + direction * 2, kind: "castle", rookFrom, rookTo: origin + direction });
    }
  }
  const normal_move = definition.normal_move;
  if (normal_move.straight) genStraight(normal_move.straight);
  if (normal_move.diagonal) genDiagonal(normal_move.diagonal);
  if (normal_move.horse) genHorse();
  if (normal_move.normal_pawn) genNormalPawn();
  if (normal_move.castle) genCastle();
  const candidates = Math.abs(piece) === pieceIds.pawn ? moves.flatMap((move) => {
    if (move.kind !== "rotate" && move.kind !== "castle" && move.kind !== "en-passant" && Math.floor(move.to / 8) === (color === "white" ? 0 : 7)) {
      return promotionPieces.map((promotion) => ({ ...move, promotion }));
    }
    return [move];
  }) : moves;
  return candidates.filter((move) => {
    const toRow = Math.floor(move.to / 8);
    const toCol = move.to % 8;
    if (move.kind !== "rotate") {
      if (move.to === enemyKingPos) return false;
      if (move.kind === "ch") {
        const capturedRow = (row + toRow) / 2;
        const capturedCol = (col + toCol) / 2;
        if (capturedRow * 8 + capturedCol === enemyKingPos) return false;
      }
    }
    const undo = saveUndoInformation(board, move, castling, standard);
    const nextKingPos = piece === kingId ? move.to : kingPos;
    makeMove(board, move, castling, standard);
    try {
      return isKingSafe2(board, color, nextKingPos);
    } finally {
      unmakeMove(board, move, undo, castling, standard);
    }
  });
}

// src/components/common/rules.ts
function legalMovesForPiece(board, from, castling, standard) {
  return standard ? LegalMoveGenerate2(board, from, castling, standard) : LegalMoveGenerate(board, from, castling);
}
function kingSafe(board, color, standard) {
  return standard ? isKingSafe2(board, color) : isKingSafe(board, color);
}

// src/components/common/draw_rules.ts
var AUTOMATIC_DRAW_PLIES = 150;
function hasInsufficientMaterial(board, ruleset) {
  let whiteKings = 0, blackKings = 0, bishops = 0, knights = 0;
  let bishopColor;
  for (let square = 0; square < 64; square++) {
    const piece = board[square], id = Math.abs(piece);
    if (!piece) continue;
    if (id === pieceIds.king) {
      if (piece > 0) whiteKings++;
      else blackKings++;
      continue;
    }
    if (id === pieceIds.knight) {
      knights++;
      continue;
    }
    if (id !== pieceIds.bishop) return false;
    bishops++;
    const color = (Math.floor(square / 8) + square % 8) % 2;
    if (bishopColor === void 0) bishopColor = color;
    else if (bishopColor !== color) return false;
  }
  if (whiteKings !== 1 || blackKings !== 1) return false;
  if (knights === 0) return true;
  return ruleset === "normal" && knights === 1 && bishops === 0;
}
function automaticDrawReason(board, ruleset, halfmoveClock) {
  if (hasInsufficientMaterial(board, ruleset)) return "insufficient-material";
  return halfmoveClock >= AUTOMATIC_DRAW_PLIES ? "seventy-five-moves" : null;
}
function nextHalfmoveClock(board, move, clock) {
  const reset = Math.abs(board[move.from]) === pieceIds.pawn || move.kind === "c" || move.kind === "ch" || move.kind === "en-passant";
  return reset ? 0 : clock + 1;
}

// src/components/common/game_state.ts
function isGameOver(status) {
  return status.kind !== "playing" && status.kind !== "check";
}
function getGameStatus(board, turn, castling = createCastlingState(), standard, halfmoveClock = 0) {
  const safe = kingSafe(board, turn, standard);
  for (let square = 0; square < board.length; square++) {
    if (pieceColor(board[square]) === turn && legalMovesForPiece(board, square, castling, standard).length > 0) {
      const draw = automaticDrawReason(board, standard ? "normal" : "chaos", halfmoveClock);
      return draw ? { kind: "draw", reason: draw } : { kind: safe ? "playing" : "check" };
    }
  }
  return safe ? { kind: "stalemate" } : { kind: "checkmate", winner: turn === "white" ? "black" : "white" };
}
function createGame(board, turn = "white", castling = createCastlingState(), ruleset = "chaos", standardState = createStandardState(), halfmoveClock = 0) {
  const flags = { ...castling };
  const standard = ruleset === "normal" ? cloneStandardState(standardState) : void 0;
  return { board, ruleset, standard, castling: flags, turn, selectedSquare: null, lastMove: null, capturedPieces: [], status: getGameStatus(board, turn, flags, standard, halfmoveClock), halfmoveClock, plyCount: 0, drawOffer: null, pendingPromotion: null };
}
function gameReducer(state, action) {
  if (action.type === "restart") return createGame(action.board, "white", createCastlingState(), state.ruleset);
  if (isGameOver(state.status)) return state;
  if (action.type === "resign") return {
    ...state,
    board: state.pendingPromotion?.boardBefore ?? state.board,
    status: { kind: "resigned", winner: action.color === "white" ? "black" : "white" },
    selectedSquare: null,
    pendingPromotion: null,
    drawOffer: null
  };
  if (action.type === "offer-draw") {
    if (state.pendingPromotion || state.drawOffer) return state;
    return { ...state, drawOffer: action.color, selectedSquare: null };
  }
  if (action.type === "respond-draw") {
    if (!state.drawOffer || action.color === state.drawOffer) return state;
    return {
      ...state,
      drawOffer: null,
      selectedSquare: null,
      status: action.accept ? { kind: "draw", reason: "agreement" } : state.status
    };
  }
  if (state.pendingPromotion) {
    if (action.type !== "promote" || !promotionPieces.includes(action.piece)) return state;
    const { boardBefore, moves } = state.pendingPromotion;
    const move2 = moves.find((candidate) => candidate.kind !== "rotate" && candidate.promotion === action.piece);
    if (!move2) return state;
    return completeMove({ ...state, board: boardBefore }, move2);
  }
  if (action.type === "promote") return state;
  if (action.type === "engine-move") {
    if (action.expectedBoard !== state.board || action.turn !== state.turn || pieceColor(state.board[action.move.from]) !== state.turn) return state;
    const move2 = legalMovesForPiece(state.board, action.move.from, state.castling, state.standard).find((candidate) => candidate.to === action.move.to && candidate.kind === action.move.kind && (candidate.kind === "rotate" ? action.move.kind === "rotate" && candidate.piece === action.move.piece : candidate.kind === "castle" ? action.move.kind === "castle" && candidate.rookFrom === action.move.rookFrom && candidate.rookTo === action.move.rookTo : candidate.kind === "en-passant" ? action.move.kind === "en-passant" && candidate.capturedSquare === action.move.capturedSquare : action.move.kind !== "rotate" && candidate.promotion === action.move.promotion));
    return move2 ? completeMove(state, move2) : state;
  }
  const { board, turn, selectedSquare } = state;
  if (action.type === "click") {
    const [row, col] = action.square;
    if (row < 0 || row >= 8 || col < 0 || col >= 8) return state;
    if (!selectedSquare) {
      if (pieceColor(board[row * 8 + col]) !== turn) return state;
      return { ...state, selectedSquare: action.square };
    }
    if (selectedSquare[0] === row && selectedSquare[1] === col) {
      return { ...state, selectedSquare: null };
    }
  }
  if (!selectedSquare) return state;
  const legalMoves = legalMovesForPiece(board, selectedSquare[0] * 8 + selectedSquare[1], state.castling, state.standard);
  const move = legalMoves.find(
    (candidate) => action.type === "rotate" ? candidate.kind === "rotate" : candidate.kind !== "rotate" && candidate.to === action.square[0] * 8 + action.square[1]
  );
  if (!move) return state;
  if (move.kind !== "rotate" && move.promotion) {
    const preview = board.slice();
    preview[move.to] = preview[move.from];
    preview[move.from] = 0;
    return {
      ...state,
      board: preview,
      selectedSquare: null,
      lastMove: { from: move.from, to: move.to, kind: move.kind },
      pendingPromotion: {
        square: [Math.floor(move.to / 8), move.to % 8],
        color: turn,
        boardBefore: board,
        moves: legalMoves.filter((candidate) => candidate.kind !== "rotate" && candidate.to === move.to && candidate.promotion)
      }
    };
  }
  return completeMove(state, move);
}
function completeMove(state, move) {
  const castling = { ...state.castling };
  const standard = state.standard ? cloneStandardState(state.standard) : void 0;
  const halfmoveClock = nextHalfmoveClock(state.board, move, state.halfmoveClock);
  const board = applyMove(state.board, move, castling, standard);
  const captured = state.board.filter((piece, square) => pieceColor(piece) === (state.turn === "white" ? "black" : "white") && board[square] !== piece);
  const turn = state.turn === "white" ? "black" : "white";
  return {
    board,
    ruleset: state.ruleset,
    standard,
    castling,
    turn,
    selectedSquare: null,
    lastMove: move,
    capturedPieces: [...state.capturedPieces ?? [], ...captured],
    status: getGameStatus(board, turn, castling, standard, halfmoveClock),
    halfmoveClock,
    plyCount: state.plyCount === void 0 ? void 0 : state.plyCount + 1,
    drawOffer: state.drawOffer === turn ? null : state.drawOffer,
    pendingPromotion: null
  };
}

// src/components/utils/fen_parcer.ts
function parseFen(fen) {
  const ranks = fen.split(" ")[0].split("/");
  if (ranks.length !== 8) throw new Error("FEN must contain eight ranks");
  return ranks.flatMap((rank) => {
    const squares = [];
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        squares.push(...Array(Number(char)).fill(0));
      } else {
        const name = pieceNames[char.toLowerCase()];
        if (!name) throw new Error(`Unknown FEN piece: ${char}`);
        squares.push(makePiece(name, char === char.toUpperCase() ? "white" : "black"));
      }
    }
    if (squares.length !== 8) throw new Error("FEN ranks must contain eight squares");
    return squares;
  });
}
export {
  createGame,
  gameReducer,
  hasInsufficientMaterial,
  isGameOver,
  legalMovesForPiece,
  parseFen,
  pieceColor
};
