// Shared by the browser worker and Node benchmarks; no dependency on Rooke.
export function loadPosition(engine, request) {
    const { board, turn, standard, castling, halfmoveClock = 0 } = request;
    if (!Array.isArray(board) || board.length !== 64 || !board.every(p => Number.isInteger(p) && Math.abs(p) <= 7)
        || board.filter(p => p === 7).length !== 1 || board.filter(p => p === -7).length !== 1
        || !['white', 'black'].includes(turn) || !Number.isSafeInteger(halfmoveClock) || halfmoveClock < 0) throw new Error('Invalid Merlin position.');
    if (!standard || board.some(p => Math.abs(p) === 5)) throw new Error('Merlin plays Classic chess only. Choose Rooke or Kestrel for Havoc.');
    const data = new Int32Array(engine.HEAP32.buffer, engine._merlin_input(), 70);
    data.set(board); data[64] = turn === 'white' ? 1 : -1; data[65] = standard ? 1 : 0;
    data[66] = standard ? (standard.castlingRights.white.kingSide ? 1 : 0) | (standard.castlingRights.white.queenSide ? 2 : 0)
        | (standard.castlingRights.black.kingSide ? 4 : 0) | (standard.castlingRights.black.queenSide ? 8 : 0) : 15;
    data[67] = (castling?.white ? 1 : 0) | (castling?.black ? 2 : 0);
    data[68] = standard?.enPassantTarget ?? -1; data[69] = Math.min(150, halfmoveClock);
    engine._merlin_load();
}
export function decodeMove(packed, board) {
    if (!packed) return null;
    const from = packed & 63, to = (packed >>> 6) & 63, kind = ['m', 'c', 'ch', 'rotate', 'castle', 'en-passant'][(packed >>> 15) & 7];
    const move = { from, to, kind };
    if (kind === 'rotate') move.piece = Math.abs(board[from]) === 4 ? 'diagonalrook' : 'rook';
    if (kind === 'castle') { move.rookFrom = from + (to > from ? 3 : -4); move.rookTo = from + (to > from ? 1 : -1); }
    if (kind === 'en-passant') move.capturedSquare = to + (board[from] > 0 ? 8 : -8);
    const promotion = (packed >>> 12) & 7;
    if (promotion) move.promotion = { 2: 'knight', 3: 'bishop', 4: 'rook', 6: 'queen' }[promotion];
    return move;
}
export function searchPosition(engine, request) {
    loadPosition(engine, request);
    const time = request.timeMs ?? 3000, depth = request.maxDepth ?? 32;
    if (!Number.isFinite(time) || time < 1 || time > 10000 || !Number.isInteger(depth) || depth < 1 || depth > 32) throw new Error('Invalid Merlin search limits.');
    const opening = Number.isSafeInteger(request.plyCount) && request.plyCount >= 0 && request.plyCount < 6;
    const seed = ((request.evaluationSeed ?? 0) ^ Math.imul(request.plyCount + 1, 0x9e3779b9)) >>> 0;
    engine._merlin_opening(opening ? 12 : 0, seed);
    const packed = engine._merlin_search(time, depth);
    return { move: decodeMove(packed, request.board), depth: engine._merlin_stat(1), nodes: engine._merlin_stat(0), elapsedMs: engine._merlin_stat(2), score: engine._merlin_stat(3), quiescenceNodes: engine._merlin_stat(4) };
}
