# Actual engine depth timing and position counts

Reproduce the seeded legal middlegame:

```sh
node benchmarks/engine-depth.mjs
node benchmarks/engine-depth.mjs --no-pruning
```

An optional integer argument changes the seed. These commands overwrite the latest results. The unpruned baseline disables only the alpha-beta cutoff in memory; it does not rewrite production source. Both runs enable the same optional counters.

## Position

```text
r1b1kn1r/p1npp2p/pp1bp2Q/8/2P2PP1/B4KP1/P1q5/R4BNR w - - 0 17
```

Seed 20261031; 32 legal actions from the initial position; 27 pieces; white to move; 38 legal root moves. Random construction skips rotations for standard-FEN compatibility; the timed engine can rotate.

## Current alpha-beta results

13th Gen Intel(R) Core(TM) i7-1355U; v26.10.0. Three trials per completed depth, after three depth-2 warmups. Medians below exclude fixture generation and loading. The external five-second limit applies to each trial.

| Depth | Median time | Positions visited | Positions evaluated | Cutoffs with moves remaining |
|---|---:|---:|---:|---:|
| 1 | 3.73 ms | 39 | 38 | 0 |
| 2 | 42.70 ms | 606 | 567 | 35 |
| 3 | 169.90 ms | 2,592 | 2,208 | 292 |
| 4 | 1746.54 ms | 36,400 | 34,172 | 1,817 |
| 5 | > 5,000 ms; stopped | — | — | — |

Depth-3 plain minimax: 52,675 visited; 51,024 evaluated; 766.80 ms median. Alpha-beta evaluates 23.1 times fewer positions. Both choose the same move at every completed common depth. Plain depth 4 and alpha-beta depth 5 exceeded their trial limits; no final counts are claimed for interrupted trials.

## Counter definitions

- positionsVisited: the root plus every recursively reached child position; not unique positions.
- positionsEvaluated: material evaluations at the horizon plus terminal mate/stalemate evaluations.
- movesExplored: moves made to enter a recursive search; equals positionsVisited minus one on a completed search.
- generatedMoves: legal move descriptions produced across all reached positions, including horizon terminal checks. These are not all explored. Internal trial moves used solely by legal generation for king-safety checking are not counted as search positions.
- cutoffs: alpha-beta exits with at least one sibling move still unsearched.
- movesSkipped: those immediate sibling moves, not the unvisited descendant subtrees.

Optional API:

```ts
const stats = createSearchStats();
const move = Engine(board, 'white', 4, stats);
console.log(stats);
```

Counters reset for each call. There are no per-node log messages. Timing varies with host load and JIT behavior; this run was variable, so compare counts as the stable measure of pruning and do not directly compare these instrumented timings with earlier runs. Browser/mobile performance can differ. Full samples and source hash are in engine-depth-results.json and engine-depth-unpruned-results.json.
