# Transposition table: depth under a time limit

54 local Node runs: three trials per configuration and position, including a second pass extending the two sparse positions beyond depth 8. Each move gets one 3,000 ms budget across iterative depths. Alpha-beta with move ordering, quiescence on, capture extension 8, additional check evasion 8, evaluation seed 0, both castling-used flags false. The second pass raises the depth cap to 16 in memory only.

The comparison disables hashing and table storage/lookup in the harness. Engine source files were not changed. Each engine runtime initializes its own random Zobrist table. Existing behavior recreates the transposition table at every iterative depth.

| Position | Table on: completed depths | Table off: completed depths |
|---|---|---|
| Random middlegame | 4, 4, 4 | 4, 4, 4 |
| Starting position | 4, 4, 4 | 4, 4, 4 |
| Crowded middlegame | 4, 4, 4 | 4, 4, 4 |
| Open middlegame | 5, 5, 5 | 4, 4, 5 |
| Queens & rooks | 5, 5, 6 | 5, 5, 5 |
| Pawn endgame | 13, 13, 13 | 9, 9, 9 |
| Promotion race | 9, 9, 8 | 7, 7, 7 |

Every selected run in the table stopped on the time deadline while searching the next depth. No forced-check extension abort or first-move fallback occurred. Maximum deadline overshoot across all 54 runs was 17.18 ms. Board and castling state restoration were asserted after every run.

At completed depth 8 in the initial capped pass, the pawn endgame visited 11,702 positions with the table versus 35,702 without it (67.2% fewer). The promotion race visited 46,940 versus 159,680 positions in fully completed no-table depth-8 runs (70.6% fewer). Counters include earlier iterative depths.

Interpretation: large gain in sparse positions; a smaller depth gain in the open middlegame; no added completed depth in the opening/crowded presets at this budget. Equal completed depth does not establish equal speed. Timings and achieved depths vary with runtime and machine load. These are Chaos Chess rules, not standard-chess engine results.

Raw data: transposition-depth-results.json and transposition-endgame-depth-results.json.
