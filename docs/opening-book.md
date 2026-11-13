# Opening book

Classic bot matches share a local book imported from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), revision
[`3ba6b20d31b2e6125cb0e6a2e792f400717d9d39`](https://github.com/lichess-org/chess-openings/tree/3ba6b20d31b2e6125cb0e6a2e792f400717d9d39).
The opening data is released under CC0; its dedication is preserved in
[opening-book-LICENSE.txt](opening-book-LICENSE.txt).

The subset includes **50 distinct selected lines**. It retains the original 14
and adds common replies and alternatives across open e4 games, the Sicilian,
French, Caro-Kann, Pirc, Scandinavian, Alekhine, Queen's Gambit, Slav/Semi-Slav,
Catalan, Queen's Indian, Grünfeld, London, English, and King's Indian Attack.
Selection favors established development schemes over traps and speculative
gambits. Different opening names with identical truncated move sequences are
rejected by the importer, so the count represents distinct move sequences.

Generated data retains each source ECO code, exact opening name, and original
PGN. UCI moves are converted using the game's Classic legal moves and truncated
to at most 14 plies. Some named source lines are shorter (for example the London,
Pirc, and Caro-Kann Advance); their published endpoints are preserved and engine
search resumes sooner if no continuation is indexed. No continuation moves are
invented or appended.

Weights are our configurable variety preferences, **not** Lichess popularity,
win rates, or engine evaluations. Each line contributes its weight to every
position/move it contains. Identical position/move entries combine their
weights. Selection probability is a move's weight divided by the sum at the
current position. Shared branches therefore inherit their combined line weights.

The starting position has separate first-move preferences in
`openingFirstMoveWeights` in `opening_book.ts`: **d4 188/331 (56.80%)**,
**e4 99/331 (29.91%)**, **c4 28/331 (8.46%)**, and **Nf3 16/331 (4.83%)**.
These override only the starting position, preserving the relative line weights
at all later positions, including Black's replies. All three bots share them.

Kestrel and Merlin use the book through move **5 per side** (10 plies).
Rooke uses it through move **7 per side** (14 plies). Actual elapsed half-moves
are stored with the match so repetitions and reloading cannot reset the cap.
Older saves with unknown move age skip the book. The game seed and position
produce reproducible weighted choices on retry/resume, with variety across
new games.

Lookup includes the board, turn, castling rights, en passant target, and castle
usage. Each returned move is checked for legality. An unknown position or the
move cap immediately falls through to the existing engine search; a later
transposition into the book can use it again while still below the cap.
Havoc skips this Classic-only repertoire. Benchmark workers and engine search
APIs continue to measure engine calculation; match test mode labels book moves
as “Opening book,” without inventing an evaluation score.

To regenerate, download `a.tsv` through `e.tsv` at the pinned revision above into
a directory and run:

```sh
node scripts/import-opening-book.js /path/to/chess-openings
```

The importer selects the explicit ECO/name pairs in `selections` (first matching
source row meeting its explicit minimum length, defaulting to 14 plies),
validates the full PGN by legal replay, and
writes `src/components/common/opening_book_data.ts`. Change weights or the
selection list there, then regenerate. Run `node tests/opening-book.test.mjs`
to check every branch, weighted choice distribution, caps, and persistence.
