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
