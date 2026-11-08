# Player badges

Badges are permanent account achievements. Accounts still start at **500 Elo**;
On the Rise unlocks at **600 Elo**. Earned dates never change on retries or after
falling below a milestone. Draws and losses reset the current multiplayer winning
streak; local, bot, abandoned and otherwise unrated matches do not affect it.

## Storage and award paths

The user stores a bounded `badges` map (14 IDs to first-earned dates), at most
three `equippedBadges`, and three counters under `badgeProgress`: `classicWins`,
`chaosWins`, and `winStreak`. `statsUpdatedAt` prevents old result screens from
rolling back a newer displayed Elo or match count.

Rated multiplayer awards run inside the existing Elo finalization transaction.
They add no user reads, writes, network requests, scheduled callbacks, or move-time
checks beyond the existing finalization operations. `finalizedAt` makes repeated
results harmless. A game stores only newly awarded badge IDs/dates and its small
result stats, rather than copying the whole badge collection on every game.

The existing five-minute, demand-refreshed leaderboard query qualifies accounts
with **five completed rated matches**. It also projects the four leaderboard
badge dates for those same 100 players. New awards are batched into at most one
update per newly qualifying player, in a transaction with snapshot publication.
A stale lease cannot award badges, and a failed award prevents publication of
that snapshot. Refreshes with no new awards retain the original single snapshot
write. Public standings contain no badge inventory or private profile fields.

Rank badges use the published snapshot's competition ranks and 100-row cutoff,
including its existing tie policy. Ranking first awards all four tiers. Awards
are retained after leaving the leaderboard. Temporary ranks between published
snapshots do not earn badges. No rank query runs after every match.

## Account endpoints

All require authentication, strict request fields, the existing account-write
rate limit, and private/no-store responses.

- `POST /api/user/badges/rooke-win` with `{}` trusts the player's reported win,
  intentionally without replaying or verifying the game. One atomic pipeline
  update grants Rooke Awakening and, when appropriate, the secret badge. It never
  alters Elo, wins, matches or streaks. Known repeat claims perform no update;
  concurrent submissions preserve the original dates.
- `POST /api/user/badges/sync` with `{}` opens the collection and uses the user
  already read by authentication to award missing Elo/total-win milestones.
  It performs no update when current. No old matches are queried. Existing
  mode-specific and streak progress starts with this feature; those historical
  counters cannot be reconstructed from total wins alone.
- `POST /api/user/badges/equip` with `{ "equippedBadges": ["first-blood"] }`
  accepts only distinct, owned, known IDs, up to three. Ordering is preserved.
  An empty array clears the display. Unchanged selections perform no update.
  Updates modify only the equipped field, preserving concurrent award writes.

The badge dialog syncs once on open and saves once on confirmation. Profile data
already includes badge ownership. Equipment is included in the existing match
player snapshot at creation, and is held for that match (including rematches).
Result notifications and profile stat updates reuse existing match snapshots;
there is no badge polling or separate opponent-profile request.

Three Musketiers' name and artwork are public; its description remains null in
the static catalog, and its unlock logic remains in the backend. Do not add the
rule to client code, tooltips or accessible descriptions.

SVGs are served from `public/badges` with no image transformation service.
No new cloud service, queue, cron job or database index is required for badges.

## Verification

`npm test` includes badge thresholds, permanent dates, streaks and modes, both
secret-unlock orders, rejected forged/duplicate equipment, idempotent Rooke
claims, lazy legacy milestones, tied leaderboard ranks, transaction-session
propagation and stale-lease fencing, and older-match profile merging. Tests use
fake stores and local servers, with no cloud account writes.
