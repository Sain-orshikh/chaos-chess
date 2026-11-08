# Live matches after matchmaking

The live service owns legal moves, clocks, results and rating finalization. The browser previews legal moves and renders a countdown; it cannot submit a result, rating, clock or starting position. `/classic/demo` and `/chaos/demo` remain local previews.

## Matchmaking boundary

After two authenticated users have been matched, call `liveRuntime().service.create` from trusted backend code with:

```js
const match = await liveRuntime().service.create({
    white, black, // Database users: _id, username/displayName, profileImg, elo
    ruleset: 'normal', // or 'chaos'
    timeMs: 300_000,
    incrementMs: 0,
    rated: true,
});
// Send each player /classic/<match._id> or /chaos/<match._id>.
```

There is intentionally no public match-creation endpoint taking arbitrary player IDs. Matchmaking itself is outside this change. The existing Mongo deployment must support transactions for Elo finalization, as before.

## Production configuration

Configure these variables on the **API service**, alongside its existing Mongo/JWT/origin settings:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `PUBLIC_API_URL=https://havoc-chess.vercel.app` (the public origin, without `/api`)

Redis carries broadcast hints; durable positions and presence leases live in Mongo. QStash calls the signed `/api/live/deadline` endpoint. Missing configuration fails closed with 503; there is no production in-memory fallback. Use HTTPS and the existing strict origin allowlist. The Vercel Express service exports an HTTP server with WebSocket upgrades and rotates connections after 270 seconds; enable the platform's WebSocket/Fluid Compute support for that service.

`npm run build` generates `backend/generated/chess.js` from the same TypeScript rules used by the browser. Keep that generated file with the backend service when deploying it separately. `npm run dev:api` also rebuilds it before starting the API.

## State and recovery

- `/api/live/:gameId/socket`: authenticated, player-only socket. `/api/live/:gameId`: authenticated snapshot.
- Commands include a UUID and expected revision. Exact retries are idempotent; stale commands and mismatched request-ID reuse are rejected. A promotion is one complete move.
- Updates use Mongo compare-and-swap. Install a durable wakeup before committing, commit before publishing. Broadcast failure recovers through heartbeat/reconnect snapshots.
- Clock arithmetic uses server timestamps; the browser animates locally every 100 ms. Heartbeats are 10 seconds; connection leases last 20 seconds. Server-measured lag allowance is capped at 100 ms and cannot revive an expired clock.
- On disconnect, the chess clock continues and the player has 60 seconds to return. No own accepted move means abandonment without Elo; otherwise disconnect loses. An earlier flag wins precedence. Multiple tabs have separate leases; a stale tab close cannot evict a newer connection.
- The earliest deadline is rechecked by durable callbacks even with both browsers closed. Finished rated matches retry the existing atomic rating transaction after temporary failure.
- Draws require opponent consent; the recipient's move expires the offer. Automatic material/75-move draws use shared rules. Flag results check the winner's mating material. Rematches require both players, use a new ID, swap colors and preserve time/rules.

## Verification and free-tier budget

`npm test` covers shared move legality, special moves, clocks, authorization, stale/duplicate requests, concurrent writes, disconnect precedence, multi-tab recovery, outages, rating retries, rematches and actual two-client WebSocket exchange. Browser verification uses the explicitly opted-in loopback-only fixture below, with fake users and no real rating writes.

```sh
LIVE_BROWSER_FIXTURE=1 node tests/fixtures/live-browser.mjs
API_BACKEND_URL=http://127.0.0.1:5001 npm run build
npm run start -- --hostname 127.0.0.1 --port 3006
```

Open `http://127.0.0.1:5001/test-login?side=white` and `http://localhost:5001/test-login?side=black`, then follow their redirects. Separate hosts isolate the fake login cookies. Never deploy the fixture. Its adapter counters are test calls, **not measured Upstash billing commands**.

The current implementation keeps one periodic deadline chain per live match, at most about once every 20 seconds, plus earlier flags and delivery retries. At 1,000 deliveries/day, this alone is roughly 5.5 aggregate match-hours/day before retries; a five-minute match uses about 15 periodic deliveries. Redis publishes on presence/move updates and has one subscription per player tab. Measure actual Redis command/egress and QStash delivery counters with a configured staging account before inferring capacity. No real provider traffic or billing was measured during local verification.

Production credentials, a deployed smoke test and the matchmaking caller remain activation steps. Local test success does not establish cross-instance delivery or production routing.

## Matchmaking

`/chaos` and `/classic` are account-only matchmaking lobbies. Supported clocks are
5+0 and 10+0; there are four separate queues. Both queues use the existing shared
account Elo, read from Mongo rather than accepted from the client. Colors use a
server-side cryptographic coin flip.

The mutual rating window starts at 100, grows by 100 every 5 seconds, caps at 800,
and becomes unrestricted at 60 seconds. Both entrants must allow the rating gap.
Oldest compatible ticket wins, then nearest rating. The matcher examines up to
128 oldest candidates within the caller's range per heartbeat. Search heartbeats
run every 5 seconds and renew a 45-second lease. A vanished browser expires;
a reload within the lease retains the original join time. Cancel acts across tabs.
A pairing already committed takes precedence over cancellation.

The implementation deliberately uses Mongo for authoritative queue tickets as well
as games: one transaction updates both tickets and creates the match. This avoids
an atomicity gap between Redis reservations and Mongo creation. The account ID is
the ticket's unique primary key; all modes, tabs and rematch creation share that
lock. Mongo must support transactions (as already required for Elo). Expired
queued records are ignored and reused; matched records remain recoverable until
replaced after the game ends. No QStash jobs are created for queue waiters.
Existing game deadline callbacks are scheduled before transaction commit. A
failed schedule aborts the transaction, preserving previous queue positions.

Endpoints: public GET `/api/matchmaking/counts`; authenticated POST `/presence`,
`/join` (`ruleset`, `timeMs`), `/status`, `/cancel`. All are under `/api/matchmaking`.
Status resumes active matches (including rematches), and performs a matching pass
for a queued user. Duplicate joins retain join time; switching queues requires
cancelling first. Counts expose only aggregate values, never account IDs/ratings.

Redis maintains an approximate global count of recently visible authenticated
accounts. Each account has one sorted-set member, refreshed every 30 seconds
and aged out after 75 seconds. This includes players browsing bot/local pages;
searching is a separate count. Hidden/offline tabs can age out. Guest users are
not counted. Provider errors display unavailable counts rather than fabricated
zeroes. Counts and matchmaking still need deployed Redis/QStash/Mongo verification.

Local test: `node tests/matchmaking.test.mjs`. Browser fixture (no real accounts,
ratings or provider writes): `LIVE_BROWSER_FIXTURE=1 node
 tests/fixtures/live-matchmaking-browser.mjs`, then run Next with
`API_BACKEND_URL=http://127.0.0.1:5002 npm run dev -- --hostname 127.0.0.1 --port 3007`.
Visit `http://127.0.0.1:5002/test-login?side=white` and
`http://localhost:5002/test-login?side=black` to isolate two synthetic accounts.

Queue presence is tracked per matchmaking tab (maximum eight per account). Navigation or pagehide removes only that tab’s lease; the last departure immediately prevents new pairings. The ticket retains its original waiting time for up to 45 seconds so reloads/brief interruptions can resume. A failed leave beacon falls back to lease expiration. A separate open matchmaking tab keeps the account searching. Explicit Cancel removes the account’s search across all tabs. `/api/matchmaking/leave`, `/join` and `/status` accept the tab connection UUID; queued counts exclude tickets with no live tab lease.
