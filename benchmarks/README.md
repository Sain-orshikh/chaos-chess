# Bot benchmark summary

Development benchmarks completed in October–November 2026. Strength screenings
used Stockfish 17.1 with limited strength, three seconds per move for both engines,
paired colors, and an independent python-chess referee.

| Bot | What the benchmarks demonstrated |
| --- | --- |
| **Rooke** | Scored 4 wins and 2 losses in six Classic games: beat nominal 1320/1520 opponents, lost both games at 1720. Provisional engine-scale estimate: about **1650**. Across 250 moves: no legal-move disagreements or fallback moves; median completed depth 4. |
| **Kestrel** | Scored 5 wins and 1 loss in six Classic games against nominal 1520–1920 opponents; provisional estimate about **2050**. Across 196 moves: no legal-move disagreements or fallbacks; median depth 6. In eight Classic/Havoc speed fixtures, median search throughput was **18.6× Rooke’s**. Browser workers completed opening depth 7 in both variants within roughly three seconds. |
| **Merlin** | Classic bitboards delivered **2.40× faster fixed-depth searches** than Kestrel and 1–2 extra plies in four timed fixtures. Initial six-game screenings scored 4 wins / 2 losses without static exchange evaluation (SEE), and 4 wins / 1 draw / 1 loss with SEE. A fresh SEE-only test against nominal 2220–2420 opponents scored **2 wins / 10 losses**, fitting about **2030**, substantially below the initial ~2350 estimate. Stable 2300-level strength was not demonstrated. |

Correctness checks covered standard perft positions, random legal-move parity,
special moves, deadlines, and state restoration. Merlin also passed exhaustive
magic-table checks; its SEE matched an independent oracle on 1,891 captures and
promotions. Distinct killer slots were retained; recapture/SEE ordering trials
showed mixed timings and no reliable strength improvement. SEE was later enabled
by product choice, not a conclusive benchmark win.

These are small local engine comparisons, not human-platform ratings or direct
head-to-head rankings. Opening coverage, resumed games, nominal opponent ratings,
and host load limit the estimates. Speed tests used an Intel i7-1355U and shipped
WebAssembly in Node; they do not guarantee mobile performance. Displayed bot
ratings are product labels, separate from these fitted estimates.

Raw results, game replays, and development runners were removed after completion.
Engine regression tests remain under `tests/`.
