# Chess move-generation benchmark

Run from the repository root:

```sh
node benchmarks/move-generation.mjs --verify-only
node benchmarks/move-generation.mjs
```

The full run takes roughly 30–60 seconds. It writes latest-results.json. It does not modify application code or configure a production bot.

## Measured environment

13th Gen Intel(R) Core(TM) i7-1355U; v26.10.0; linux/x64. Measured 2026-10-30T18:40:22.948Z. Timings are local Node measurements, not a browser or mobile guarantee.

## Results

| Position | Pieces | White legal moves | All White moves, median | Depth 5 search, median | Completed depth within 1.2 s |
|---|---:|---:|---:|---:|---:|
| Starting position | 32 | 22 | 7.9 µs | 223.7 ms | 5 |
| Crowded middlegame | 30 | 40 | 10.8 µs | 945.8 ms | 5 |
| Open middlegame | 16 | 59 | 16.1 µs | 678.8 ms | 5 |
| Sparse queens and rooks | 6 | 34 | 10.2 µs | 168.4 ms | 6 |
| Pawn endgame | 4 | 5 | 2.0 µs | 0.8 ms | ≥7 |
| Promotion race | 4 | 11 | 2.3 µs | 11.0 ms | ≥7 |
| Rotated rook endgame | 6 | 24 | 8.8 µs | 105.7 ms | 6 |

Depth counts individual player actions (plies), including rook rotations. The depth column is the minimum completed depth across three independent iterative searches. Runs stop at depth 7, so ≥7 does not mean the time budget was exhausted. Depth-5 timing is for that iteration only; earlier iterations also consume time.

## Method and limits

Seven synthetic fixtures cover opening, crowded and open middlegames, sparse sliding pieces, pawns, promotion, and rotated rooks. These are Chaos Chess rules, so counts should not be compared with standard chess perft tables.

Generation uses the actual current per-piece generator, called for every friendly piece. Five warmed samples each run for at least 100 ms. Loading and TypeScript transpilation occur before timing. Repeated identical positions are an optimistic throughput measurement; recursive trials exercise changing positions.

Full-tree counting (perft) runs three trials per depth through depth 4, abandoning a depth if a trial exceeds roughly 900 ms. Raw counts and timings are in latest-results.json.

The benchmark-only search uses alpha-beta, material evaluation, capture/promotion ordering, terminal detection at leaves, and make/unmake. It includes all four promotion choices. Three independent iterative searches have a 1200 ms total budget each. Deadlines are checked every 256 visited nodes, so small overruns are possible. There is no transposition table, quiescence, repetition handling, or production bot integration. Material-only search and favorable ordering can produce optimistic depth results; depth is not a playing-strength measurement.

Verification compares make/unmake traversal against a separate copied-board traversal, and alpha-beta against unpruned minimax at depth 2, for both sides of every fixture. Board restoration is asserted after recursive trials and timeouts.

## Suggested initial bot policy

Use iterative deepening (depth 1, then 2, then 3, and so on), with a proposed 1-second target and 1.2-second hard deadline. Keep the best move from the last fully completed iteration; start with a fallback legal move. A depth cap of 8 is a reasonable initial guard, subject to browser measurements. Do not guarantee a minimum depth when a deadline is reached.

Expect about depth 4–5 in busy positions and deeper in simple endings on this measured CPU, with substantial dependence on ordering and future evaluation work. Do not select depth solely from piece count: the 16-piece open fixture has 59 legal moves, compared with 22 at the 32-piece start.

Run the eventual browser bot in a Web Worker and repeat these measurements in that worker on target devices. More sophisticated evaluation and quiescence will change the timings.

References: [Stockfish iterative search](https://github.com/official-stockfish/Stockfish/blob/master/src/search.cpp), [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).
