# Merlin — Classic-only bitboard engine

Merlin is the third bot, developed separately from Rooke and Kestrel. Only
Classic offers Merlin. Havoc retains its existing Rooke/Kestrel implementations.
Parallel Stockfish screenings with and without SEE are recorded in
[the benchmark summary](../../benchmarks/README.md). The frontend uses the chosen
approximate Classic ratings: Merlin 2250, Kestrel 1850, Rooke 1450. The new standalone win badge does not affect Three Musketiers.

## Representation and search

Merlin starts from a copy of Kestrel's search/evaluation, including its tapered
king map and bounded check extensions. It adds incrementally maintained 64-bit
piece/color occupancies, precomputed pawn/knight/king attacks, and fancy magic
lookup tables for rook/bishop/queen attacks. A square array remains as a fast
piece-identity cache; bitboards and the array are checked together in native tests.

Candidate king-safety checks use hypothetical occupancies, including captured
piece removal, en passant removal, and both castling pieces. They avoid updating
hashes/evaluation just to reject illegal moves. Real searched moves still use
incremental make/unmake. Move-generation order matches Kestrel. The initial bitboard comparison also
matched visited-node counts; subsequent killer-ordering changes intentionally
allow different node counts at the same depth.
These changes reduce search cost; strength screenings are recorded separately.

Magic numbers are generated offline by this repository's deterministic generator.
Startup builds and validates lookup tables from the stored constants; it never
searches for magic numbers in the browser. There are 107,648 uint64 attack entries
(841 KiB), plus masks and short-range attack tables. The pasted explanation's
approximately 111 KiB estimate omitted the eight bytes per attack entry. Hash
collisions are valid when they produce identical attacks, rather than requiring
unique occupancy indices. Runtime access uses portable WASM i64 operations,
without requiring native x86 PEXT or WebAssembly threads.

## Reproduce

Activate Emscripten (this build: 7.0.0), then `npm run build:merlin`. Generated JS
and WASM ship in `public/engines/`; regular app builds require no C++ toolchain.

- `npm run test:merlin`: actual WASM, opening perft through depth 5, Kiwipete,
  Classic random legal-move comparisons, special moves, mate, deadline/restoration,
  and rejection of Havoc input.
- `g++ -O2 -std=c++17 tests/merlin-native.cpp -o /tmp/merlin-test` then run it:
  all 107,648 blocker subsets, 128,000 arbitrary occupancies, make/unmake bitboard,
  hash/evaluation invariants, and tapered king-map checks.
- To regenerate constants: compile `engine/merlin/find-magics.cpp` with C++17/O3
  and write its stdout to `engine/merlin/magics.h`, then rebuild and rerun tests.

The underlying magic hashing technique is described in Niklas Fiekas's thesis:
https://backscattering.de/magics2.pdf. The constants and code here are generated
locally; no external engine implementation or constant arrays were copied.

Results: [benchmark summary](../../benchmarks/README.md).


## Killer-slot and recapture experiment

`recordKiller` keeps two distinct nonempty moves per ply. Repeating the most
recent killer preserves the older alternative; repeating the older one promotes
it and keeps the previously newest move. History bonuses still update on every
qualifying cutoff. These changes apply only to Merlin.

The screenshot-inspired recapture heuristic is implemented behind the compile
switch `MERLIN_RECAPTURE_ORDERING=1`, disabled in production by default. It orders
lower-value captures later if an enemy piece attacks the target after the
capture, accounting for vacated squares and en passant. Promotions retain their
priority and the transposition-table move stays first. It never prunes a move.
This is not SEE: pinned defenders and longer exchange sequences can mislead it.

The legacy variant uses `MERLIN_DISTINCT_KILLERS=0`; the production default is 1.
All variants share the same search/evaluation and corrected signed score
reporting. A mixed signed/unsigned stats expression previously displayed negative
scores as very large positive numbers; score reporting now preserves the sign.
This reporting fix does not alter search decisions.

See [the benchmark summary](../../benchmarks/README.md) for the findings.
No Elo evaluation is part of this experiment.


## Static exchange evaluation

`staticExchange` now evaluates a complete on-square exchange sequence on a local
bitboard state, without touching the live position. It forces the initial move,
then alternates least-valuable legal recapturers and backs up material gains so
either side can decline the next exchange. Sliding x-rays are recomputed each
step. Pinned recaptures and unsafe king captures are rejected. Initial en passant
and promotion/underpromotion are supported; later pawn recaptures on the last
rank promote to a queen. Equal-value attackers break ties by square.

This is standard least-valuable-attacker, material-only SEE, not a full tactical
search: it does not consider off-square checks or alternative equally valued
attacker branches. It is used only to classify captures for ordering, never to
prune. Cached best moves and promotions retain priority. The ordering path skips
SEE when the initial captured material already guarantees a nonnegative sign.

`MERLIN_SEE_ORDERING=1` selects SEE instead of the old recapture shortcut. The
production default is now 1, enabled at the user’s request after testing.
Distinct killer slots remain enabled; the old shortcut remains disabled.
The earlier performance experiment did not establish an overall gain; later
strength screenings are documented separately.

`npm run test:merlin:see` compares the exported WASM SEE function against an
independent oracle built from the app's legal-move generator and make/unmake.
It covers 1,891 captures/promotions, pinned defenders, legal/illegal king
recaptures, multi-piece trades, x-rays, en passant, and promotion during a trade.
The oracle uses the same documented least-value policy, but independently derives
legal moves and exchange gains. Native tests also verify the live state is intact.

Benchmark findings are retained in [the summary](../../benchmarks/README.md).
Algorithm reference:
https://www.chessprogramming.org/SEE_-_The_Swap_Algorithm.


## Parallel strength screening

Six three-second games per variant finished: no SEE 4 wins / 2 losses (pooled
screening estimate 2266); SEE 4 wins / 1 draw / 1 loss (2348). These are nominal
Stockfish-scale estimates, not stable human-platform ratings. SEE led by half a
point in this small sample. Broad uncertainty and interrupted/restarted games
prevent a reliable strength conclusion. SEE was subsequently enabled at the
user’s request; the chosen frontend ratings are approximate labels, not fitted
ratings from this screening.

The variants were assigned different physical performance cores and used the
same opponent levels, openings and colors. The referee validates every legal-move
set. A later twelve-game SEE-only screening scored 2 wins and 10 losses against
nominal 2220–2420 opponents, with a pooled estimate around 2030. This did not
establish stable 2300-level strength. See [the benchmark summary](../../benchmarks/README.md).
