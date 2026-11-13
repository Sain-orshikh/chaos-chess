# Kestrel

An independent C++17 engine compiled to WebAssembly. Rooke's engine, evaluation,
worker, panel, and badge implementation are unchanged. Shared UI code selects
which bot to run. Saved matches preserve the selected bot; older saves use Rooke.

## Build and test

Install Emscripten, activate its environment, then run `npm run build:kestrel`.
This build used Emscripten 7.0.0, `-O3 -flto`, without threads or SIMD requirements.
The generated JS and WASM in `public/engines/` ship with the app; normal Next builds
need no C++ compiler. Rebuild those files whenever the C++ source changes.

- `npm run test:kestrel`: actual WASM; standard perft through depth 4, special moves,
  deterministic random Classic/Havoc legality comparisons, mate, and deadlines.
- `g++ -O2 -std=c++17 tests/kestrel-native.cpp -o /tmp/kestrel-test && /tmp/kestrel-test`:
  independently recompute hashes/evaluation through make/unmake; king-map blending.

## Search and evaluation

The browser worker loads one module and runs the complete search in WASM. The
three-second deadline starts after module initialization. No JavaScript calls
occur per searched node. Cancellation terminates the worker.

The board uses compact numeric pieces, packed 32-bit moves, stack move buffers,
small undo records, incremental 64-bit Zobrist hashing and material/PST evaluation.
A bounded 524,288-entry transposition table survives iterative-deepening passes
within a move. Search uses alpha-beta, principal variation search, cached-best
move ordering, capture/promotion ordering, killer moves, and history ordering.
Checks extend the search by one ply, with at most two extensions per line.
Quiescence searches captures/promotions, with eight capture plies; checked nodes
continue searching legal evasions up to the absolute 96-ply safety limit.
Only fully completed depths replace the previous result; a legal fallback exists.

The original opening PST formula is retained for Kestrel, with the exact supplied
8×8 image as its king endgame table. Black mirrors ranks. Opening weight is
remaining non-pawn, non-king material divided by starting material (6400 Classic,
6000 Havoc), clamped to [0,1]. The endgame weight is its complement. Both armies
contribute, so the transition is continuous as material comes off. Other piece
PSTs also taper. Kestrel uses these centipawn bonuses directly and is deterministic.
Rooke's bounded positional correction and seeded opening noise are untouched.

Classic and Havoc share the search but use their own movement and attack rules,
material values, castling, promotions, and en-passant behavior. Havoc includes
rook rotation and friendly bishop jumps. Dead-material and 75-move draws match
the app. Search-path repetition is detected; pre-root history is not supplied
by the current app, so historical threefold claims are not evaluated by Kestrel.
Stockfish matches independently adjudicate threefold repetition.

The badge endpoint follows the existing client-reported Rooke policy, requires
sign-in, preserves first-earned dates, and changes no ratings or multiplayer
progress. Kestrel Conqueror has no role in Three Musketiers.

## Results

See [the benchmark summary](../../benchmarks/README.md).
The six-game screening finished 5–1, with a pooled estimate around 2050 on the
nominal opponent scale. The lobby and board label it as provisional Classic.
