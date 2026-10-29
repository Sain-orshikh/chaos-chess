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

The limits are held in memory for one API process and reset when it restarts. For multiple instances, add a shared store or gateway limiter. Forwarded IP headers are not trusted by default. Behind the Next.js proxy, configure `TRUST_PROXY` only for trusted proxy IPs/CIDRs and ensure that ingress replaces untrusted forwarding headers; otherwise requests share the proxy’s IP limit. Restrict direct access to the backend in production.

## Checks

```sh
pnpm test
pnpm lint
pnpm build
```

The tests cover the custom engine, injection payloads, upload validation, rate limits, and session validation. UI checks cover desktop/mobile navigation, setup, local play, rook actions, and the Encyclopedia.

Fonts are self-hosted Barlow and Barlow Condensed under the included Open Font License. The sidebar uses the bishop SVG and the lettering from the original logo concept. The standalone prototype remains in `design/`.
