# Chaos Chess

Next.js interface with an Express / MongoDB account backend. The Play bot page currently runs local 1v1 using the existing custom chess engine. Bot opponents, Casual, Ranked, Chaos mode, and Leaderboard are unavailable.

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

Search runs in a Web Worker. Each trial has a time limit; Stop terminates the worker. Incomplete rows report partial counts and never claim a completed depth. FEN validation requires one king per side, legal king safety for the side that just moved, and no unpromoted back-rank pawns. Standard castling/en-passant fields are accepted but unused by Chaos Chess rules.

Move ordering ranks captures and promotions at every searched node. Zobrist hashing is labeled as planned. Hashing will be shared by all methods when implemented. This page measures the existing engine and does not connect it to the local-match screen.


Quiescence search is enabled by default and extends every normal search horizon with captures and promotions. Checked sides search all legal evasions, including quiet moves; the next side's check status is tested again. The default whole-search deadline is 5 seconds. The default quiescence capture budget is 8 extra plies, plus up to 8 further plies for forced check evasions. Set `maxTimeMs`, `maxQuiescencePly`, and `quiescence` in the engine options or use the Engine lab controls. At the capture cap, a safe position gets a static evaluation; checked positions may use the additional `maxCheckEvasionPly` allowance. An unresolved check at the combined hard limit aborts that search with `QuiescenceLimitError`, and the lab reports an incomplete extension-limit row. No incomplete move is returned as a completed result. The lab includes quiescence nodes in its total counts and reports them separately in the Q nodes column. Old static-depth comparisons can be reproduced with quiescence disabled.
