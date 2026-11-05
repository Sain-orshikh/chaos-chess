# Rooke Classic: provisional strength estimate

Rooke scored 4 wins, 0 draws, and 2 losses against Stockfish 17.1 with limited
strength enabled. Both engines had three seconds per move.

| Stockfish UCI_Elo setting | Rooke wins | Draws | Rooke losses |
| --- | ---: | ---: | ---: |
| 1320 | 2 | 0 | 0 |
| 1520 | 2 | 0 | 0 |
| 1720 | 0 | 0 | 2 |

The practical screening bracket is **1520–1720 on this test's engine scale**.
A pooled logistic fit gives 1666; round that to **about 1650**, rather than
presenting the fitted number as a precise rating.

The fit solves `sum(expected score against each opponent) = total scored points`,
using `expected = 1 / (1 + 10 ** ((opponent - rating) / 400))`.
Its descriptive 95% profile-likelihood interval is approximately 1354–2028.
Even that wide interval assumes independent game outcomes and exact opponent
ratings, and omits opening/color correlation and calibration uncertainty.

This was an adaptive six-game screening with one opening family and paired,
swapped colors. The initial run was stopped after four wins so stronger
opponents could be tested. The stronger run was stopped after the paired 1720
losses supplied an upper bracket. Incomplete follow-up games are excluded from
both results and rating calculations. The small sample and limited opening
coverage make this a rough estimate. More games with diverse paired openings
and opponents near 1600–1800 are needed for a stable rating.

The independent referee found **zero legal-move-set disagreements** across
Rooke's 250 moves in the completed games. Rooke used **zero fallback moves**;
its median completed search depth was 4, with depths ranging from 2 to 9.
The app engine source hashes match between both runs.

Stockfish's nominal limited-strength Elo is calibrated at 120 seconds plus one
second per move and anchored to CCRL 40/4. Our three-second results do **not**
establish a FIDE, Chess.com, or Lichess rating.
See [Stockfish's official documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#uci_elo).

Artifacts:

- [Combined statistics](rooke-classic-rating.json)
- [1320/1520 results](rooke-classic-matches.json) and [replays](rooke-classic-matches.pgn)
- [1720 results](rooke-classic-stronger.json) and [replays](rooke-classic-stronger.pgn)
- [Runner instructions](engine-matches.md)

No rating was added to the application UI from this small screening.
