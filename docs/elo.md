# Rated online game finalization

Bot, anonymous, and local games remain unrated. Online multiplayer is not implemented yet; this API is the finalization step for that future service.

`POST /api/games/:gameId/finalize` requires a signed-in participant and an empty JSON body (`{}`). The caller cannot submit player names, ratings, or a winner.

Trusted online-game code must create a `Game` with distinct `playerA` and `playerB` user IDs and `rated: true`. After validating the final move, resignation, or accepted draw, that service must persist `status: "finished"` and `result: "a" | "b" | "draw"`. No public endpoint currently writes those fields. For reliable settlement even if both browsers disconnect, the future online service must also trigger finalization itself.

The finalization transaction reads the current user ratings, applies K=40 below 1000 and K=30 otherwise, rounds to integer ratings, increments both match counts and the winner's wins, and saves a rating snapshot plus `finalizedAt`. Repeated calls by either participant return the stored snapshot. Concurrent changes to the same game or user conflict and retry through MongoDB's transaction handling. Different K values can produce different point gains and losses; ratings are not clamped at zero.

MongoDB must support multi-document transactions (Atlas or a replica set). There is no fallback to partial, non-transactional updates.

The frontend helper is `finalizeGame(gameId)` in `src/lib/api.ts`. The future online screen should supply its server-issued ID through `<Board onlineGameId={gameId} ... />`. When the finished result dialog mounts, it calls the endpoint and displays saved ratings or a retry button. Current local/bot screens supply no online ID and make no finalization request. Rematches must receive a new server-issued ID. The server's saved result must exist before publishing the finished game to clients; an early client request gets a 409 and can be retried.

Success response:

```json
{
  "gameId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "result": "a",
  "ratings": {
    "a": { "userId": "bbbbbbbbbbbbbbbbbbbbbbbb", "before": 1200, "after": 1215, "change": 15 },
    "b": { "userId": "cccccccccccccccccccccccc", "before": 1200, "after": 1185, "change": -15 }
  }
}
```

The user model's existing initial rating (0) is preserved. Any initial-rating change or migration should be decided separately.
