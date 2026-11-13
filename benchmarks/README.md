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
head-to-head rankings at the three-second setting. Opening coverage, resumed games, nominal opponent ratings,
and host load limit the estimates. Speed tests used an Intel i7-1355U and shipped
WebAssembly in Node; they do not guarantee mobile performance. Displayed bot
ratings are product labels, separate from these fitted estimates.

## Internal 100 ms head-to-head — November 13, 2026

Rooke played 20 Classic games against each of Merlin and Kestrel (40 total),
with a **100 ms search budget per move for every bot**. These limits applied only
to the internal runner; the app's three-second defaults were unchanged. The
shipped Merlin/Kestrel WebAssembly and Rooke TypeScript search were used.

| Matchup | Rooke wins | Draws | Rooke losses | Rooke score |
| --- | ---: | ---: | ---: | ---: |
| Rooke vs Merlin | 0 | 1 | 19 | 0.5/20 (2.5%) |
| Rooke vs Kestrel | 0 | 2 | 18 | 1/20 (5%) |

Each matchup used ten fixed opening prefixes, each played twice with colors
reversed (ten games per color) and the same evaluation seed for both games in a
pair. Prefixes covered Open Game, Sicilian, French, Caro-Kann, Queen's Gambit,
Slav, Indian, English, Reti, and Italian openings; each supplied four plies,
except the Italian's six. Both matchups used the same prefixes and seeds
(20261113 through 20261122), retaining each bot's normal opening variation.

An independent python-chess referee checked all 2,991 searched moves and compared
the app's entire legal-move list at every searched position: zero disagreements
or illegal moves. All 40 complete replays and final results were checked again.
The 37 decisive games ended in checkmate; all three draws were claimable
threefold repetitions. Draws were claimed immediately when available; no game
reached the 600-ply safety cap. No evaluation-based adjudication was used.

Median completed depth was 2 for Rooke, 5 for Merlin, and 4 for Kestrel.
Rooke used a legal fallback before completing depth 1 on 3/773 moves against
Merlin and 7/713 against Kestrel; neither opponent returned a depth-zero move.
Median measured search calls were about 103 ms for all bots; the largest was
139 ms, so 100 ms was a cooperative search budget rather than a hard wall-clock
cutoff. The two matchup runners ran concurrently on the same host. These short
local tests demonstrate a substantial gap at this time budget, not an Elo
estimate or a ranking at longer time controls.

## Kestrel vs Merlin — 50 games, November 13, 2026

The shipped WebAssembly engines played 50 Classic games with the same **100 ms
search budget per move**. Merlin scored **25 wins, 19 draws, and 6 losses**,
earning **34.5/50 (69%)**; Kestrel scored **15.5/50 (31%)**.

| Kestrel color | Kestrel wins | Draws | Merlin wins |
| --- | ---: | ---: | ---: |
| White (25 games) | 4 | 10 | 11 |
| Black (25 games) | 2 | 9 | 14 |
| **Total** | **6** | **19** | **25** |

Twenty-five fixed opening prefixes were each played with colors reversed and
the same evaluation seed within each pair (20261113 through 20261137). The first
ten prefixes matched the Rooke test above. The remaining fifteen covered Ruy
Lopez, Scotch, Petrov, Philidor, Scandinavian, Alekhine, Pirc, Modern, Vienna,
King's Gambit, London, Dutch, Nimzo-Indian, Catalan, and Symmetrical English.
Prefixes supplied four or six plies; normal seeded opening variation was retained.
Two runners processed separate opening pairs concurrently on the same host.

The independent python-chess referee checked all **4,877 searched moves**, with
zero illegal moves or disagreements between its legal-move list, the app's list,
and the moving engine's own list. All 50 full replays, results, final positions,
opening pairs, and color assignments were independently verified afterward.
All 31 decisive games ended in checkmate; all 19 draws were claimable threefold
repetitions. Draws were claimed immediately when available. No game reached the
600-ply safety cap; no evaluation-based adjudication was used.

Median completed depth was **4 for Kestrel** (2,434 moves) and **5 for Merlin**
(2,443 moves), with no depth-zero results. Median measured search calls were
103.06 ms and 102.77 ms respectively; the largest was 116.67 ms. As above, the
100 ms setting was a cooperative budget, not a hard wall-clock cutoff. App
defaults were unchanged. This sample favors Merlin at this short time control;
it does not establish an Elo rating or a ranking at longer time controls.

Raw results, game replays, and development runners were removed after completion.
Engine regression tests remain under `tests/`.
