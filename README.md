# Havoc Chess

Next.js interface with an Express / MongoDB account backend, online Classic/Havoc play, and a cached Elo leaderboard. The Play bot page includes Rooke using the existing custom chess engine.

## Run locally

Use the existing `.env`, or copy `.env.example` to `.env` and configure MongoDB and a random `JWT_SECRET`. Cloudinary credentials enable profile picture uploads. Keep real secrets out of version control.

Install dependencies with `pnpm install`, then run these in separate terminals:

```sh
pnpm dev:api
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Next.js forwards `/api/*` to `API_BACKEND_URL`, which defaults to `http://127.0.0.1:5000`; the browser uses a same-origin HTTP-only session cookie. In production, set `NODE_ENV=production`, use HTTPS, and set `FRONTEND_URL` to the exact frontend origin.

## Play and accounts

- Anonymous visitors can immediately start a local match. Accounts are optional.
- Setup and the chess match are separate screens. White, Black, and Random choose board orientation; both sides remain locally controlled.
- The existing engine enforces legal moves, king safety, checkmate, stalemate, bishop jumps, and alternating turns.
- Selecting a rook opens Move and Switch choices over its square. Switching consumes one turn and is disabled if it would expose the king. Escape or selecting the original square cancels selection.
- The sidebar reads Elo, matches, and wins from the account. Local games never send results or update those fields. Bot games must also remain unrated when implemented.
- Sign in, account creation, sign out, password changes, and picture updates use the existing backend endpoints.
- The Encyclopedia animates the custom movements. Reduced-motion preferences are respected.

## API validation and limits

The backend uses MongoDB, not SQL. Usernames and passwords must be strings; operators, nested query objects, arrays, unknown fields, and profile writes to Elo/matches/wins are rejected before reaching database queries. Usernames contain 3–24 letters, numbers, or underscores. Passwords are hashed with bcrypt and limited to 72 UTF-8 bytes.

Profile images use `{ name, type, data }`, where `data` is a base64 data URL. Only JPG/JPEG, PNG, WebP, and GIF are accepted, up to 2 MB and 16 million pixels. Sharp checks the decoded format, strips metadata, and re-encodes to a static WebP thumbnail before Cloudinary receives it. SVGs, remote image URLs, corrupt files, and mismatched types are rejected.

- General API: 120 requests per minute per IP.
- Login and signup combined: 10 attempts per 15 minutes per IP.
- Profile updates: 10 attempts per 15 minutes per authenticated account.
- Excess requests receive HTTP 429 with `Retry-After`.

Production and Vercel use atomic MongoDB counters shared across instances. Counter keys hash the client identifier and time window; a TTL index cleans up expired counters. If the store is unavailable, requests receive 503 rather than bypassing limits. Local development uses in-memory counters. Vercel's overwritten ingress IP header is trusted only on Vercel. For other hosting, configure `TRUST_PROXY` only for trusted proxy IPs/CIDRs that replace client-supplied forwarding headers.

## Vercel hosting and logs

`vercel.json` uses Vercel Services (beta) to deploy Next.js and the existing Express app together. `/api/*` routes to the `backend` service; all other paths route to Next.js. Express exports its app without opening a listening socket on Vercel. MongoDB connections and their initialization promise are reused by warm instances.

In the existing Vercel project, add these environment variables for Preview and Production before deploying:

- `MONGODB_URI`: the hosted MongoDB connection string, with network access configured for the deployment.
- `JWT_SECRET`: a long random signing secret.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`: the existing image account credentials.
- `FRONTEND_URL`: the exact production origin. Same-origin preview requests are also accepted automatically.
- Optional `LOG_LEVEL` (default `info`).

Do not configure `API_BACKEND_URL`, `PORT`, or `TRUST_PROXY` for this Vercel setup. Keep credentials server-only, without a `NEXT_PUBLIC_` prefix. Existing `VITE_CLOUDINARY_CLOUD_NAME` is accepted as a fallback, but new setups should use `CLOUDINARY_CLOUD_NAME`.

Backend logs are structured JSON emitted through Pino to stdout/stderr and captured in the project's **Logs** tab on Vercel. Each request gets an `X-Request-Id` response header; search its `reqId` in Runtime Logs to correlate errors with request status and duration. Headers, cookies, request bodies, URL query strings, credentials, and image data are excluded or redacted. Logs are not written to local files. Vercel's retention depends on the plan; connect a log drain if longer retention is needed.

Vercel Web Analytics is mounted once in the root layout. After deploying, visit the site to send page views and inspect the project's Analytics tab. Local games remain unrated; analytics does not update Elo or match counts.

## Checks

```sh
pnpm test
pnpm lint
pnpm build
```

The tests cover the custom engine, injection payloads, upload validation, rate limits, session validation, MongoDB connection reuse, shared counter races, and HTTP log redaction. UI checks cover desktop/mobile navigation, setup, local play, rook actions, and the Encyclopedia.

Fonts are self-hosted Barlow and Barlow Condensed under the included Open Font License. The sidebar uses the bishop SVG and the lettering from the original logo concept. The standalone prototype remains in `design/`.


### Engine lab

Open `/engine-lab` (Explore → Engine lab) to preview preset or custom FEN positions and compare plain minimax, alpha-beta, and alpha-beta with move ordering. The browser measures all-side legal move generation separately, then searches depths 1 through the chosen maximum, using one trial or the median of three. Results include visited/evaluated positions, cutoffs, search time, and the chosen move; click a move to highlight it on the preview.

Search runs in a Web Worker. Each trial has a time limit; Stop terminates the worker. Incomplete rows report partial counts and never claim a completed depth. FEN validation requires one king per side, legal king safety for the side that just moved, and no unpromoted back-rank pawns. Standard castling/en-passant FEN fields are accepted but do not encode this variant’s castling history. FEN-only positions start with both colors’ one-time castle unused.

Move ordering ranks captures and promotions at every searched node. Zobrist hashing is labeled as planned. Hashing will be shared by all methods when implemented. This page measures the existing engine and does not connect it to the local-match screen.


Quiescence search is enabled by default and extends every normal search horizon with captures and promotions. Checked sides search all legal evasions, including quiet moves; the next side's check status is tested again. The default whole-search deadline is 5 seconds. The default quiescence capture budget is 8 extra plies, plus up to 8 further plies for forced check evasions. Set `maxTimeMs`, `maxQuiescencePly`, and `quiescence` in the engine options or use the Engine lab controls. At the capture cap, a safe position gets a static evaluation; checked positions may use the additional `maxCheckEvasionPly` allowance. An unresolved check at the combined hard limit aborts that search with `QuiescenceLimitError`, and the lab reports an incomplete extension-limit row. No incomplete move is returned as a completed result. The lab includes quiescence nodes in its total counts and reports them separately in the Q nodes column. Old static-depth comparisons can be reproduced with quiescence disabled.

Rooke (the lowest bot slot) is playable from **Play bot → Rooke → Play Rooke**. Its preview uses the current optimized engine: alpha-beta, capture/promotion ordering, and quiescence. Strength has not been Elo calibrated. The match panel lets you change the search method, maximum depth, total time per move, and quiescence/check-extension limits between bot turns. Defaults are depth 4 and 3 seconds per move. A dedicated worker searches depths 1 upward within one shared time budget, retaining the last completed move if a deeper search aborts. If no depth completes, it explicitly reports a legal fallback. Statistics include every attempted depth and partial work; the generation time is a single root measurement. Restart and leaving the match cancel the worker, and the game reducer rejects stale or illegal replies.

Static evaluation now includes `utils/checkmate_eval.ts`: the materially stronger side receives a king-approach / enemy-edge bonus when it has a non-pawn piece. `endgameWeight(enemyNonKingPieces)` is `clamp(1 - count / 8, 0, 1)`, so the defender's pieces determine the phase even if the attacker still has many pieces. The bonus is also scaled by `min(1, materialLead / rookValue)`; equal material and pawn-only attackers receive no king-driving bonus. White's bonus is positive and Black's is negative. Tune `DEFAULT_CHECKMATE_EVAL_SCALE` (default 5, before the combined positional bound), or pass `checkmateEvalScale` (0–100) to `Engine`; zero disables king-driving; also set `positionalScale: 0` for material-only static evaluation. Actual mate/stalemate detection still takes precedence, and mate scores include distance from the root to prefer faster wins and delay forced losses. The heuristic guides shallow searches toward mating positions; it does not guarantee a forced mate.

Castling is available once per color. Earlier king or rook moves do not remove it: the king must be back on e1/e8, the same-color straight rook on a1/h1/a8/h8, and all intervening squares empty. The king must be safe before and after castling; crossing an attacked square is allowed. Select the king and c1/g1/c8/g8 to castle. `GameState.castling` stores `{ white, black }`, where true means already castled. The flags travel to the bot worker and through every search node. Castle moves record `rookFrom` and `rookTo`; undo restores all four squares and the previous flags. Pass the same `CastlingState` to generation, make/save/undo when managing positions manually. `applyMove` copies the board but updates supplied flags in place, so copy those flags too when preserving a parent position. `Engine` clones `options.castling` and preserves its inputs; omitted flags mean a fresh position. Benchmark requests also accept castling flags.

Piece-square tables live in `utils/positional_eval.ts`. Their small raw bonuses encourage short-range knight/bishop development and central control, advancing pawns, early king shelter near c/g files, and active kings later. Early queen advances receive a small penalty. Remaining non-pawn material on both sides blends opening and endgame tables. Straight and diagonal rooks share the exact same tables and phase value. The combined piece-square and king-driving correction is smoothly bounded strictly within ±40 points: even the largest difference between positional bonuses is below a pawn’s 100-point value. Terminal mate/stalemate results are unchanged. `positionalScale` defaults to 1 (range 0–2); `checkmateEvalScale: 0, positionalScale: 0` disables both heuristics. Rooke samples one seed per new game for stable opening-table noise of at most ±0.25 raw points per piece; both colors share mirrored values. The seed persists across turns and iterative depths, and rook forms share the same noise. Endgame tables have no noise. Engine lab remains deterministic with seed 0; `Engine` and bot requests accept an explicit `evaluationSeed` for reproducible comparisons.

### Google sign-in

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, and `MONGODB_URI` for the API service, locally and in Vercel. In Google Cloud, add **Authorized redirect URI** `https://havoc-chess.vercel.app/api/auth/google/callback` (the domain alone is not sufficient). For local development, also add `http://localhost:3000/api/auth/google/callback` and run both the web and API servers. Production sign-in always returns to `https://havoc-chess.vercel.app`.

The account dialog offers **Continue with Google**. Google accounts store the verified Google subject and display name; the sidebar and game board show that name. Existing password accounts keep their usernames. Accounts are not automatically linked by name or email. MongoDB must allow the unique sparse `googleId` index to be created. If Google consent is in Testing mode, add the intended test users in Google Cloud before testing.

### Leaderboard

`/leaderboard` lists the top 100 accounts by Elo with games and wins. Players qualify after 5 completed rated online
matches; equal Elo shares rank. One MongoDB
snapshot refreshes on demand after five minutes, coordinated across API instances
by an expiring lease. Vercel caches the public response for one minute. Pagination
and the personal Elo gap use the downloaded list without more ranking queries.
Leaderboard snapshots include profile-image URLs and up to three equipped badge IDs using the existing top-100 query. Images load lazily from their saved URLs with initials as fallback; badge artwork is static. No per-player profile requests, Redis commands or QStash jobs are added. The snapshot payload is capped at 128 KB.
The page footer notes that changes may take 6–7 minutes to appear.
See [the architecture and free-tier budget](docs/leaderboard-plan.md) for rollout
checks, index requirements, failure behavior, and usage estimates.


### Developer’s note and search visibility

The sidebar and top bar open the developer’s note. `/about` serves the same content as a public page; edit `src/components/developer-note.tsx` to update both. The homepage and note link to Sainorshikh’s portfolio.

Public pages have individual titles, descriptions, canonical URLs, social previews, and a sitemap at `/sitemap.xml`. The production origin is defined in `src/lib/site.ts`; update it if the domain changes. `/chaos` and its match URLs permanently redirect to `/havoc`. The internal `chaos` ruleset and badge IDs remain stable for existing matches, saves, and accounts. Individual match pages use `noindex` and are excluded from the sitemap.

After deployment, verify the production property in Google Search Console, submit the sitemap, and inspect `/` and `/about` for indexing. Confirm the portfolio’s Havoc Chess entry links to the production game. These account-level steps are separate from the repository changes.
