# Rooke Classic strength screening

The match runner uses the actual app's `searchBot`, default search settings, and
Classic rules. A separate python-chess referee compares the complete legal move
set on every Rooke turn and checks every played move. A mismatch stops the run.
Stockfish receives the full move history.

Requirements: Node with the project's installed TypeScript package,
`python-chess` (tested with python-chess 1.999 / chess 1.11.2), and a Stockfish
executable. These tools are for experiments; they add no application dependency.

```sh
python3 benchmarks/engine-match.py \
  --stockfish /path/to/stockfish \
  --games 8 --time-ms 3000 --elos 1320 1520 \
  --output benchmarks/new-classic-run.json
```

Use a fresh output name: the JSON is replaced as games complete, while PGN games
are appended. The adjacent `.stderr` file contains errors from the app bridge.

The eight-game screening uses two opening families, with a color-swapped pair
against each opponent setting in each opening. Both engines get three seconds
per move. Stockfish uses one thread, 16 MB hash, strength limiting, and no
pondering. Rooke retains its normal depth cap and quiescence settings. Results,
search depths, fallbacks, starting seeds, and source hashes are saved in JSON;
complete games are saved in PGN.

Checkmate and automatic draws are decided by the referee. Threefold repetition
is explicitly adjudicated as a draw for this experiment. Unfinished games at the
300-ply limit have result `*` and are excluded from rating calculations.

The per-opponent estimate is `opponent + 400 log10(score / (1 - score))`.
An all-win or all-loss group has no finite point estimate. The reported Wilson
intervals are descriptive approximations; they do not account for paired games
or uncertainty in the opponent's nominal rating.

Stockfish's limited-strength Elo is calibrated at 120 seconds plus one second
per move and anchored to CCRL 40/4. Our three-second test therefore gives a
provisional engine comparison, not a FIDE, Chess.com, or Lichess rating.
See [Stockfish's UCI documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#uci_elo).
