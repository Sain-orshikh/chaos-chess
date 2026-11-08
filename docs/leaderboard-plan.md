# Leaderboard proposal

Status: design and architecture only; implementation awaits design confirmation.
Reviewed: 8 November 2026. Provider allowances below are public free-tier limits,
not verified balances in this project's accounts.

## Recommended product scope

- `/leaderboard`, linked from Explore, using the existing sidebar, breadcrumb,
  Barlow/Barlow Condensed, charcoal surfaces, red accents, angular avatars, and
  restrained panel borders.
- One all-time, combined leaderboard. The current user model has one `elo`,
  `matches`, and `wins` shared by rated Classic and Chaos games. Separate mode or
  time-control rankings would require new rating data and a migration policy.
- Top 100, ordered by Elo descending; 25 rows per page, paginated locally from
  one downloaded snapshot. No arbitrary limit, sort, search, or date queries.
- Proposed qualification: 10 completed rated online games. This is a product
  default for confirmation, not an existing rule. Bot/local games do not count.
  Existing server finalization increments `matches` only for rated games.
- Equal Elo shares competition rank (1, 1, 3). `_id` ascending provides stable
  ordering within ties; the list remains capped at 100 even at a tied cutoff.
  State this in the ranking help. Qualification and tie policy are versioned.
- Columns: rank, player, Elo, rated games, win rate (`wins / matches`). A win
  rate is the percentage won, not the Elo score; draws are not counted as wins.
- Initial avatars in v1: consistent with the existing avatar fallback and no
  leaderboard image traffic. Display names are escaped text and bounded; expose
  an account handle when needed to disambiguate duplicate display names.
- Personal strip computed in the browser from the snapshot and existing auth:
  ranked users see their snapshot entry; other qualified users see “Outside the
  top 100”; others see qualification progress. No global exact-rank count query.
  Snapshot values and current account values must be labeled separately when
  they differ. Keep personal content outside the shared API response.
- Guests can read the list. Timestamp and qualification note remain visible.
  Copy: “Refreshes about every 5 minutes”; never imply live ranking.
- Recommended layout: **Contenders**, three compact leaders above the standings.
  Alternative: **Standings**, the table immediately below the heading, with the
  first three ranks accented. Both use the same backend and fields.
- Mobile: existing navigation drawer; no podium grid squeezed into columns.
  Stack the leaders and show rank, player, Elo as primary row content, with
  games/win rate on a second line. No horizontal scrolling needed.
- Explicit states: loading skeleton, no qualified players, fewer than three
  players, guest, qualification progress, outside top 100, refresh failure with
  retained data and timestamp, and unavailable with Retry when no data exists.
  Preview players are fictional and must never ship as fallback rankings.

## Repository findings that affect the design

- `backend/models/user.model.js`: current initial Elo is **500**. Some existing
  prose still says 0 or that online play is not implemented; code is authoritative.
- `backend/controllers/user.controller.js`: ratings, matches and wins settle in
  a MongoDB transaction, idempotently per game. Leaderboards must read settled
  user records, not client-submitted game results or live game player snapshots.
- `backend/server.js`: all `/api` currently receives `private, no-store`, a
  Mongo connection, and a Mongo-backed general rate-limit write. A new public
  route must be deliberately mounted before those account-specific middleware.
  Leave their behavior on existing endpoints intact.
- `next.config.ts`: Cache Components and Partial Prefetching enabled. Installed
  Next 16.4.3 docs were reviewed. Ordinary `use cache` is per-instance by default,
  so it is not the cross-instance source of truth for this design.
- `src/lib/api.ts`: the account API helper is for credentialed, uncached calls;
  use a dedicated public snapshot fetch without auth headers or credentials.
- `AuthProvider`: signed-in visible tabs already send presence every 30 seconds.
  The new page inherits this unless changed explicitly (see budget below).

## Recommended architecture: CDN plus a MongoDB snapshot

Use existing MongoDB for one small durable snapshot and a refresh lease. Add no
service, no Redis leaderboard keys, no scheduler and no per-game refresh job.
MongoDB remains involved on origin cache misses, but the ordered user query runs
only when the shared snapshot expires. This saves the Redis budget for live play.

```text
Browser → Vercel CDN → public Express endpoint → one Mongo snapshot document
                  HIT: no function/DB call       │
                                                └─ expired + lease winner:
                                                   indexed top-100 user query
                                                   → atomic snapshot publish
```

### Data and index

New `leaderboardSnapshots` collection, one `_id: "global:v1"` document per
environment/database:

```text
schemaVersion, generatedAt, nextRefreshAt, entries[<=100],
leaseOwner, leaseUntil, nextAttemptAt
```

Entries expose only an opaque account ID (for local self matching), display
name/handle, Elo, matches, wins and rank. Never return password/hash, Google ID,
email, tokens, provider credentials, or an entire user document. Target serialized
response <=25 KB, with explicit size validation. No avatar URLs in v1.

Proposed user index: `{ elo: -1, _id: 1 }` with
`partialFilterExpression: { matches: { $gte: 10 } }`. Query explicitly includes
the same qualification predicate, projects allowed fields, sorts by that index,
limits to 100, uses lean results and `maxTimeMS: 2000`. Verify with
`explain("executionStats")` that it uses the index, avoids a blocking sort, and
examines about 100 qualifying documents rather than all users. A changed
qualification rule requires an index/policy version change. Build the index once
during rollout, not per request. It adds storage and updates during settlement;
measure index size in Atlas before scaling user count.

### Refresh protocol and failure handling

1. Read the fixed snapshot by `_id`; if `generatedAt` is less than five minutes
   old, return it. There is no sorting of users on this path.
2. If due and not in retry backoff, atomically acquire a 15-second lease with
   `findOneAndUpdate`, conditional on expired lease, due refresh, and due retry.
   Use an unguessable owner token. Initialize the singleton safely with `_id`
   uniqueness; duplicate-key races re-read it rather than throwing a 500.
3. Only the winner runs the bounded user query. Publish all entries and their
   timestamp in one atomic update conditioned on the same owner token and a
   still-valid lease. Set `nextRefreshAt = completion time + 300 seconds` and
   release the lease. A worker that outlives its lease cannot overwrite a newer
   snapshot. Handle a rejected publish by reading the winner's version.
4. Other requests serve the previous snapshot. With no previous snapshot, return
   uncached 503 + short Retry-After; the browser backs off. No request waits on an
   unbounded loop, and no fire-and-forget promise is left after the response.
5. On refresh failure, retain the old entries and generatedAt, release only the
   caller's lease and set a shared retry backoff (initially 60 seconds). Do not
   retry the sort once per visitor. Bounded queries must finish inside the lease.
6. With a readable stale snapshot, serve it for up to 24 hours with explicit age;
   after that return unavailable. If MongoDB is entirely unavailable, the origin
   cannot retrieve its durable snapshot: rely on an already cached CDN response
   and the browser's in-session data, otherwise show unavailable. Do not promise
   that Mongo-backed stale data survives a total database outage on a cold cache.

Keep the snapshot without a TTL index; expiration means refresh, not deletion.
No invalidation after every rated game: delayed standings are the accepted
tradeoff. Settlements remain independent of cache availability. A cold start or
redeploy keeps the durable snapshot; a deployment may still cold-start CDN copies.
New names are reflected at the next refresh; a future account deletion/moderation
feature must explicitly purge/redact public snapshots and CDN copies as required.

### HTTP contract and middleware

- Fixed `GET /api/leaderboard`; HEAD may return the same headers. No arbitrary
  `limit`, username, sort, mode, or cache-busting parameters. Reject unknown query
  parameters before accessing Mongo; do not let them trigger extra refreshes.
- Register an isolated public read router after request logging, before global
  CORS reflection, `no-store`, DB connection, IP-counter, auth, and cookie parsing.
  It connects to Mongo only on origin execution, through the existing reused
  pool. It never sets cookies, never varies by session and ignores identity.
- Successful response: `Cache-Control: public, max-age=30` and
  `Vercel-CDN-Cache-Control: public, s-maxage=60, stale-while-revalidate=30,
  stale-if-error=86400`. Keep these targeted to this route. For a known stale
  result use a shorter CDN TTL (10 seconds) and retain the actual generatedAt.
  Never cache errors. Validate the deployed Services rewrite path and header
  precedence, not merely the local Express response.
- CDN serves most requests without starting Express. A cache miss reads one
  shared document; refresh queries remain coordinated across regions/instances.
  Cookies are omitted by the public client fetch; Authorization and Set-Cookie
  must be absent. Avoid `Vary: Cookie`/`Vary: Origin` or personalization.
- Keep request-cost protection at ingress for this public fixed-resource route.
  Check the project's available Vercel Firewall rules and query/path handling
  during rollout. Do not add a Redis/Mongo counter per successful cached read.
  Invalid requests fail before database access. A fixed response and refresh
  lease bound query cost, but do not eliminate origin reads or bandwidth under
  a cache-bypass attack; observe and block abuse with supported ingress controls.
- `generatedAt` in the payload is authoritative. In normal operation a newly
  fetched response can trail settlement by roughly five minutes plus CDN/browser
  windows (allow approximately seven minutes). This is not a hard SLA.

### Browser behavior

The Next page renders a static shell inside the existing app layout; a small
client component fetches the public snapshot. No provider access at build time,
no dependency on the leaderboard for auth/game rendering. Keep the ranking data
outside a session-specific Server Component cache.

Download all 100 once, paginate 25 locally, and compute the personal strip locally.
Recheck only on entry or when returning to a visible tab after five minutes;
deduplicate simultaneous fetches and reuse in-session data for five minutes.
No interval polling while the page sits open. Age text still updates locally and
becomes “Standings may be out of date” once older than seven minutes. Re-entering
or returning to a tab can fetch again. No user-facing “force database refresh”.
Retry uses bounded exponential backoff and respects Retry-After; retained data
stays visible on failure. Explain that idle open views do not update live.

## Free-tier impact

The recommendation is low overhead for a small site. It is **not** a guarantee
that the entire app stays free: current provider usage and real traffic are not
available here. Allowances are shared with auth, games, matchmaking, presence,
uploads, analytics, and other projects attached to the same provider quota.

| Service | Published free allowance | Increment from this design / risk |
| --- | --- | --- |
| Vercel | 1M function invocations/month, 4 active CPU hours, 360 GB-hours provisioned memory; 100 GB fast data transfer, up to 10 GB origin transfer | CDN hits avoid function execution, but still use delivery requests/bandwidth. Cold misses invoke Express. Assets, auth, presence and page requests are additional. CPU must be measured, not inferred from cache ratio. |
| MongoDB Atlas Free | 512 MB data/index storage; 100 read/write ops/sec; 500 connections; 10 GB inbound and 10 GB outbound per rolling 7 days | One small snapshot + one index; one document read per origin miss; at most roughly 288 successful refresh queries/day under continuous demand. Bursts and connection pools, not monthly query-count billing, are the main risk. |
| Upstash Redis | 500K commands/month, 256 MB data, 10 GB bandwidth/month | **Zero direct leaderboard commands/storage.** Existing presence/live/matchmaking traffic still consumes this budget. |
| QStash | 1,000 delivery attempts/day | **Zero leaderboard jobs.** Keep this quota for game deadline callbacks. Retries consume more attempts. A five-minute refresh schedule would cost 288 daily deliveries before retries, so it is intentionally unnecessary. |
| Cloudinary | 25 shared monthly credits; 1 credit = 1 GB image delivery OR 1 GB storage OR 1,000 transformations | **Zero leaderboard image traffic with initial avatars.** These resources share the same pool; it is not 25 GB of each resource independently. |
| Vercel Web Analytics | 50K events/month on Hobby | Existing root analytics also tracks this page. 100K leaderboard pageviews alone can exceed this allowance even when every data response is cached. Event collection behavior/remaining quota must be checked. |

Sources checked 8 November 2026:
[Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel platform limits](https://vercel.com/docs/limits),
[Vercel compute](https://vercel.com/docs/functions/usage-and-pricing),
[Vercel Analytics](https://vercel.com/docs/analytics/limits-and-pricing),
[MongoDB pricing](https://www.mongodb.com/pricing),
[Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/),
[Redis pricing](https://upstash.com/pricing/redis),
[QStash pricing](https://upstash.com/pricing/qstash),
[Cloudinary credit accounting](https://cloudinary.com/documentation/billing_and_plans).
Cache behavior follows [Vercel cache headers](https://vercel.com/docs/caching/cache-control-headers)
and [CDN eligibility](https://vercel.com/docs/caching/cdn-cache).
Confirm delivery-request allowance in the actual Vercel dashboard; CDN hits are
not free of request accounting, even when function invocation usage is zero.

### Example incremental data budget

Planning assumptions: 30-day month, one snapshot download per visit, 25 KB
uncompressed payload, 95% CDN hit ratio. This is a scenario, not a forecast or
measured hit rate. Regions, eviction, sparse visits and cache bypass affect it.
Page HTML/JS/fonts, analytics, auth and presence are excluded here.

Let `V` be snapshot requests, `O = V × (1 - hitRatio)` origin misses, and `R` be
successful refreshes. `R <= min(O, ~8,640/month)` under the five-minute lease
protocol. Approximate Mongo commands: `O + 3R` (read, plus lease/query/publish).
Contention, retries, initial setup and failure bookkeeping add operations.

| Snapshot requests/month | Data delivery before compression | Origin invocations at 95% hits | Maximum R at this O | Approx. Mongo commands (upper planning case) |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 0.25 GB | 500 | 500 | 2,000 |
| 100,000 | 2.5 GB | 5,000 | 5,000 | 20,000 |
| 1,000,000 | 25 GB | 50,000 | 8,640 | 75,920 |

These are command counts, not documents read or Atlas billed monthly units.
Each rebuild reads up to 100 user documents. At the high scenario, snapshot
document reads return roughly 1.25 GB/month plus user-query results (~0.22 GB
if each rebuilt projection is 25 KB); compare peak rolling-week transfer to
Atlas's weekly allowance, including protocol overhead and the rest of the app.

With **0% CDN hits**, 100K requests mean 100K origin invocations and roughly
125,920 Mongo commands including the bounded refreshes; 1M requests means about
25 GB/month of snapshot reads alone, plus other traffic, and uses the entire
published function-invocation allowance before any other app endpoints. CDN
deployment verification is essential. Sustained bursts may hit Atlas's 100 ops/sec
or 500-connection cap despite acceptable monthly totals.

For CPU, use measured mean origin CPU `t` milliseconds: `O × t / 3,600,000` CPU
hours, plus rendering and all other endpoints. Provisioned-memory use likewise
depends on actual concurrency/duration. Reuse the existing bounded pool; do not
open a separate pool per request or introduce a timer-based refresh worker.

### Existing page-shell costs that caching does not fix

A visible signed-in tab calls presence twice per minute. One average continuously
visible signed-in tab over 30 days therefore adds **86,400 presence HTTP requests**
(plus startup/visibility events). Each currently also causes a general Mongo
rate-limit update, authenticated user lookup, and Redis online-set script call.
Ten such average tabs yield 864,000 presence requests before games or navigation.
Redis script metering should be checked in actual provider metrics; even at one
billed command per heartbeat, six such tabs exceed 500K monthly commands.
This is an existing app cost, not a new leaderboard snapshot cost, but additional
time spent viewing the leaderboard increases it. Multi-tab deduplication or
presence-frequency changes deserve a separate scoped follow-up if usage is high.

Avatars can be enabled later after choosing a budget. Example: 25 images × 5 KB
× 100K uncached visits = 12.5 GB (~12.5 bandwidth credits), before storage and
transformations; 100 avatars eager-loaded would be ~50 GB. Browser caching/lazy
loading help, but should not be assumed as the only protection.

## Implementation sequence after confirmation

1. Confirm layout and product defaults (100 entries, 10 rated games, combined
   rating, five-minute freshness, initials). Do not change Elo initialization.
2. Add explicit snapshot schema, partial user index and refresh service with
   token-fenced lease, bounded query and shared retry backoff.
3. Add isolated public route/middleware and response projection/cache headers.
4. Add page, local pagination, personal strip, mobile layout and all UI states;
   enable Explore navigation and correct the breadcrumb. Preserve in-progress
   unrelated game UI edits in the working tree.
5. Verify before rollout: concurrent cold starts/expiry produce one refresh;
   expired worker cannot publish; failures back off and retain timestamps;
   no private fields or cookies leak; invalid queries do not touch Mongo;
   ties/100-entry cutoff/qualification and win rates are correct; local/bot
   games remain unrated. Use fake stores to avoid consuming cloud quotas in tests.
6. Run appropriate existing tests, lint/build, and keyboard/mobile checks at
   360px and desktop. On a deployed preview verify the Services route emits
   `x-vercel-cache: HIT` on repeated anonymous and signed-in client requests,
   inspect `Age`/generatedAt and headers, and check only the canonical key is
   used. Confirm CDN hits cause no backend logs or rate-limit documents.
7. Record baseline and post-change provider usage, payload bytes, snapshot age,
   refresh count/latency/failure, origin count/hit rate, Atlas query plan/index
   size/pool connections and auth/presence volume. Use existing logs/dashboards;
   add no per-row analytics or new paid monitoring service.

At 70% of any shared quota, investigate the actual driver. At 85%, reduce optional
analytics/images/polling or increase the snapshot interval to 15 minutes while
keeping timestamp copy accurate. Adjust thresholds to the remaining monthly or
rolling-week window. CDN miss rate and presence may matter much more than top-100
query count. If small-site traffic stays within these estimates, no extra paid
service is needed; exact headroom requires the project's provider dashboards.
