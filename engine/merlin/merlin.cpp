// Merlin: independent Classic-only bitboard engine. a8=0; app piece IDs.
#include "bitboards.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
// Compile-time switches support isolated before/after benchmarks.
#ifndef MERLIN_DISTINCT_KILLERS
#define MERLIN_DISTINCT_KILLERS 1
#endif
#ifndef MERLIN_RECAPTURE_ORDERING
#define MERLIN_RECAPTURE_ORDERING 0
#endif
#ifndef MERLIN_SEE_ORDERING
#define MERLIN_SEE_ORDERING 1
#endif
using U64 = uint64_t;
constexpr int MAXPLY = 96, MAXMOVES = 512, MATE = 1000000, INF = 2000000;
// Packed move: source(6), destination(6), promotion(3), kind(3).
// kinds: quiet=0, capture=1, jump capture=2, rotate=3, castle=4, ep=5.
using Move = uint32_t;
int from(Move m) { return m & 63; }
int to(Move m) { return (m >> 6) & 63; }
int promo(Move m) { return (m >> 12) & 7; }
int kind(Move m) { return (m >> 15) & 7; }
Move move(int f, int t, int k = 0, int p = 0) {
  return f | (t << 6) | (p << 12) | (k << 15);
}
const int dr[8] = {-1, 1, 0, 0, -1, -1, 1, 1},
          dc[8] = {0, 0, -1, 1, -1, 1, -1, 1};
const int nr[8] = {-2, -2, -1, -1, 1, 1, 2, 2},
          nc[8] = {-1, 1, -2, 2, -2, 2, -1, 1};
const int values[2][8] = {{0, 100, 400, 200, 500, 500, 800, 0},
                          {0, 100, 320, 330, 500, 500, 900, 0}};
const int kingEnd[64] = {-20, -10, -10, -10, -10, -10, -10, -20, -5,  0,   5,
                         5,   5,   5,   0,   -5,  -10, -5,  20,  30,  30,  20,
                         -5,  -10, -15, -10, 35,  45,  45,  35,  -10, -15, -20,
                         -15, 30,  40,  40,  30,  -15, -20, -25, -20, 20,  25,
                         25,  20,  -20, -25, -30, -25, 0,   0,   0,   0,   -25,
                         -30, -50, -30, -30, -30, -30, -30, -30, -50};
struct Position {
  int b[64], side = 1, normal = 0, rights = 15, castled = 0, ep = -1, clock = 0,
             king[2];
  U64 occupied[2]{}, pieces[2][8]{};
  U64 hash = 0;
  double mg = 0, eg = 0;
  int material = 0, phase = 0;
};
Position pos;
U64 keys[64][15], stateKeys[512], clockKeys[151], sideKey;
double pst[2][8][64];
int input[MAXMOVES];
struct Undo {
  int squares[4], pieces[4], n = 0, rights, castled, ep, clock, king[2];
  U64 hash;
  double mg, eg;
  int material, phase;
};
struct List {
  Move m[MAXMOVES];
  int n = 0;
  void add(Move x) {
    if (n < MAXMOVES)
      m[n++] = x;
  }
};
struct Entry {
  U64 hash = 0;
  int score = 0;
  Move best = 0;
  int16_t depth = 0;
  uint8_t bound = 0;
};
// Fixed 2^19 entries; a bounded table retained across all iterative passes.
std::array<Entry, 1 << 19> tt;
Move killers[MAXPLY][2];
int history[2][64][64];
U64 path[MAXPLY];
uint64_t nodes = 0, qnodes = 0;
int completed = 0, scoreOut = 0, bestOut = 0;
double elapsed = 0;
bool stopped = false;
std::chrono::steady_clock::time_point deadline, start;
U64 rng = 0x4b65737472656c31ULL;
U64 random64() {
  rng += 0x9e3779b97f4a7c15ULL;
  U64 z = rng;
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}
int color(int p) { return p > 0 ? 1 : p < 0 ? -1 : 0; }
int ci(int s) { return s == 1 ? 0 : 1; }
bool on(int r, int c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
U64 stateHash() {
  return stateKeys[pos.rights | (pos.castled << 4) | (pos.normal << 6)] ^
         (pos.ep >= 0 ? stateKeys[128 + pos.ep] : 0) ^
         clockKeys[std::min(150, pos.clock)] ^ (pos.side == 1 ? sideKey : 0);
}
void updateBitboards(int sq, int old, int p) {
  U64 bit = U64(1) << sq;
  if (old) {
    int c = ci(color(old));
    pos.pieces[c][std::abs(old)] &= ~bit;
    pos.occupied[c] &= ~bit;
  }
  if (p) {
    int c = ci(color(p));
    pos.pieces[c][std::abs(p)] |= bit;
    pos.occupied[c] |= bit;
  }
}
void setSquare(int sq, int p) {
  int old = pos.b[sq];
  updateBitboards(sq, old, p);
  for (int j = 0; j < 2; j++) {
    int v = j ? p : old;
    if (!v)
      continue;
    int s = color(v), id = std::abs(v), q = s == 1 ? sq : sq ^ 56,
        sg = j ? 1 : -1;
    pos.hash ^= keys[sq][v + 7];
    pos.material += sg * s * values[pos.normal][id];
    pos.mg += sg * s * pst[0][id][q];
    pos.eg += sg * s * pst[1][id][q];
    if (id != 1 && id != 7)
      pos.phase += sg * values[pos.normal][id];
  }
  pos.b[sq] = p;
}
bool attacked(int k, int enemy, U64 occupancy, U64 removed = 0) {
  const auto &p = pos.pieces[enemy];
  U64 present = ~removed;
  return (bitboards::knight[k] & p[2] & present) ||
         (bitboards::king[k] & p[7] & present) ||
         (bitboards::pawn[1 - enemy][k] & p[1] & present) ||
         (bitboards::lookup(k, occupancy, false) & (p[4] | p[6]) & present) ||
         (bitboards::lookup(k, occupancy, true) & (p[3] | p[6]) & present);
}
bool safe(int s) {
  int k = pos.king[ci(s)];
  return k >= 0 && !attacked(k, ci(-s), pos.occupied[0] | pos.occupied[1]);
}
// Test king safety from a hypothetical occupancy. No hashing/evaluation updates
// are needed while filtering candidates; the real search still uses
// make/unmake.
bool legalAfter(Move m) {
  int f = from(m), t = to(m), s = pos.side, k = kind(m);
  U64 occupancy = (pos.occupied[0] | pos.occupied[1]) & ~(U64(1) << f);
  U64 removed = pos.b[t] ? (U64(1) << t) : 0;
  if (k == 5) {
    removed = U64(1) << (t + s * 8);
    occupancy &= ~removed;
  }
  occupancy |= U64(1) << t;
  if (k == 4) {
    occupancy &= ~(U64(1) << (f + (t > f ? 3 : -4)));
    occupancy |= U64(1) << (f + (t > f ? 1 : -1));
  }
  int king = std::abs(pos.b[f]) == 7 ? t : pos.king[ci(s)];
  return !attacked(king, ci(-s), occupancy, removed);
}
void change(Undo &u, int sq, int p) {
  u.squares[u.n] = sq;
  u.pieces[u.n++] = pos.b[sq];
  setSquare(sq, p);
}
Undo make(Move m) {
  Undo u;
  u.rights = pos.rights;
  u.castled = pos.castled;
  u.ep = pos.ep;
  u.clock = pos.clock;
  u.hash = pos.hash;
  u.mg = pos.mg;
  u.eg = pos.eg;
  u.material = pos.material;
  u.phase = pos.phase;
  u.king[0] = pos.king[0];
  u.king[1] = pos.king[1];
  int f = from(m), t = to(m), k = kind(m), p = pos.b[f], s = pos.side,
      id = std::abs(p);
  pos.hash ^= stateHash();
  pos.ep = -1;
  pos.clock = (id == 1 || k == 1 || k == 2 || k == 5) ? 0 : pos.clock + 1;
  if (k == 3) {
    change(u, f, s * (id == 4 ? 5 : 4));
  } else {
    if (pos.normal) {
      if (id == 7)
        pos.rights &= s == 1 ? 12 : 3;
      for (int i = 0; i < 4; i++) {
        int sqs[4] = {63, 56, 7, 0};
        if (f == sqs[i] || t == sqs[i])
          pos.rights &= ~(1 << i);
      }
      if (id == 1 && std::abs(t - f) == 16)
        pos.ep = (f + t) / 2;
    }
    change(u, f, 0);
    change(u, t, promo(m) ? s * promo(m) : p);
    if (k == 2)
      change(u, (f + t) / 2, 0);
    if (k == 5)
      change(u, t + s * 8, 0);
    if (k == 4) {
      int rf = f + (t > f ? 3 : -4), rt = f + (t > f ? 1 : -1);
      change(u, rf, 0);
      change(u, rt, s * 4);
      pos.castled |= 1 << ci(s);
    }
    if (id == 7)
      pos.king[ci(s)] = t;
  }
  pos.side = -s;
  pos.hash ^= stateHash();
  return u;
}
void unmake(const Undo &u) {
  for (int i = 0; i < u.n; i++) {
    int sq = u.squares[i];
    updateBitboards(sq, pos.b[sq], u.pieces[i]);
    pos.b[sq] = u.pieces[i];
  }
  pos.side = -pos.side;
  pos.rights = u.rights;
  pos.castled = u.castled;
  pos.ep = u.ep;
  pos.clock = u.clock;
  pos.hash = u.hash;
  pos.mg = u.mg;
  pos.eg = u.eg;
  pos.material = u.material;
  pos.phase = u.phase;
  pos.king[0] = u.king[0];
  pos.king[1] = u.king[1];
}
void generate(List &out, bool tactical = false) {
  List candidates;
  int s = pos.side, side = ci(s);
  U64 friends = pos.occupied[side], enemies = pos.occupied[ci(-s)],
      occupancy = friends | enemies;
  auto add = [&](int f, int t, int k) {
    if (pos.b[t] == -s * 7)
      return;
    if (std::abs(pos.b[f]) == 1 && t / 8 == (s == 1 ? 0 : 7))
      for (int p : {6, 4, 3, 2})
        candidates.add(move(f, t, k, p));
    else
      candidates.add(move(f, t, k));
  };
  U64 remaining = friends;
  while (remaining) {
    int f = __builtin_ctzll(remaining);
    remaining &= remaining - 1;
    int id = std::abs(pos.b[f]), r = f / 8, c = f % 8;
    if (id == 1) {
      int rr = r - s;
      if (rr >= 0 && rr < 8) {
        if (!pos.b[rr * 8 + c]) {
          add(f, rr * 8 + c, 0);
          if (r == (s == 1 ? 6 : 1) && !pos.b[(r - 2 * s) * 8 + c])
            add(f, (r - 2 * s) * 8 + c, 0);
        }
        for (int d : {-1, 1})
          if (on(rr, c + d)) {
            int t = rr * 8 + c + d;
            if (enemies & (U64(1) << t))
              add(f, t, 1);
            else if (t == pos.ep && !pos.b[t] && r == (s == 1 ? 3 : 4) &&
                     pos.b[r * 8 + c + d] == -s)
              add(f, t, 5);
          }
      }
    } else {
      U64 targets = id == 7 ? bitboards::king[f] : 0;
      if (id == 4 || id == 6)
        targets |= bitboards::lookup(f, occupancy, false);
      if (id == 3 || id == 6)
        targets |= bitboards::lookup(f, occupancy, true);
      targets &= ~friends;
      // Retain Kestrel's direction/near-to-far order to isolate representation
      // cost.
      for (int d = 0; d < 8; d++) {
        U64 ray = targets & bitboards::directions[f][d];
        bool reverse = sliders::rowStep[d] * 8 + sliders::colStep[d] < 0;
        while (ray) {
          int t = reverse ? 63 - __builtin_clzll(ray) : __builtin_ctzll(ray);
          ray &= ~(U64(1) << t);
          add(f, t, pos.b[t] ? 1 : 0);
        }
      }
      if (id == 2)
        for (int d = 0; d < 8; d++) {
          int rr = r + nr[d], cc = c + nc[d];
          if (on(rr, cc) && !(friends & (U64(1) << (rr * 8 + cc))))
            add(f, rr * 8 + cc, pos.b[rr * 8 + cc] ? 1 : 0);
        }
    }
    if (id == 7 && f == (s == 1 ? 60 : 4) && !(pos.castled & (1 << side)) &&
        safe(s))
      for (int dir : {1, -1}) {
        int rf = f + (dir == 1 ? 3 : -4), bit = side * 2 + (dir == 1 ? 0 : 1);
        if (pos.b[rf] != s * 4 || !(pos.rights & (1 << bit)))
          continue;
        U64 path = dir == 1 ? (U64(1) << (f + 1)) | (U64(1) << (f + 2))
                            : (U64(1) << (f - 1)) | (U64(1) << (f - 2)) |
                                  (U64(1) << (f - 3));
        if (occupancy & path)
          continue;
        bool crossingSafe = legalAfter(move(f, f + dir));
        if (crossingSafe)
          candidates.add(move(f, f + dir * 2, 4));
      }
  }
  for (int i = 0; i < candidates.n; i++) {
    Move m = candidates.m[i];
    if (tactical && kind(m) != 1 && kind(m) != 5 && !promo(m))
      continue;
    if (legalAfter(m))
      out.add(m);
  }
}
bool drawn() {
  if (pos.clock >= 150)
    return true;
  int knights = 0, bishops = 0, bc = -1;
  for (int sq = 0; sq < 64; sq++) {
    int id = std::abs(pos.b[sq]);
    if (!id || id == 7)
      continue;
    if (id == 2) {
      knights++;
      continue;
    }
    if (id != 3)
      return false;
    bishops++;
    int c = (sq / 8 + sq % 8) % 2;
    if (bc >= 0 && bc != c)
      return false;
    bc = c;
  }
  return knights == 0 || (pos.normal && knights == 1 && !bishops);
}
int eval() {
  double w =
      std::clamp(double(pos.phase) / (pos.normal ? 6400 : 6000), 0.0, 1.0);
  return pos.side * int(pos.material + pos.mg * w + pos.eg * (1 - w));
}
bool timeUp() {
  if ((nodes & 255) == 0 && std::chrono::steady_clock::now() >= deadline)
    stopped = true;
  return stopped;
}
void recordKiller(Move m, int ply) {
  if (!m)
    return;
#if MERLIN_DISTINCT_KILLERS
  if (killers[ply][0] == m)
    return; // Preserve the other distinct refutation.
#endif
  killers[ply][1] = killers[ply][0];
  killers[ply][0] = m;
}
// Approximate recapture risk, not static exchange evaluation. Pinned defenders
// may be counted. This changes ordering only: no move is removed from search.
bool riskyCapture(Move m) {
  int k = kind(m);
  if ((k != 1 && k != 5) || promo(m))
    return false;
  int f = from(m), t = to(m), captured = k == 5 ? t + pos.side * 8 : t;
  int victim = std::abs(pos.b[captured]), attacker = std::abs(pos.b[f]);
  if (values[pos.normal][victim] >= values[pos.normal][attacker])
    return false;
  U64 removed = U64(1) << captured;
  U64 occupancy =
      (pos.occupied[0] | pos.occupied[1]) & ~(U64(1) << f) & ~removed;
  occupancy |= U64(1) << t;
  return attacked(t, ci(-pos.side), occupancy, removed);
}
// Local exchange state: no mutation of the real board, hash, or evaluation.
struct ExchangeState {
  U64 pieces[2][8], occupied;
  int king[2];
};
U64 exchangeAttackers(const ExchangeState &state, int target, int side) {
  const auto &p = state.pieces[side];
  return (bitboards::pawn[1 - side][target] & p[1]) |
         (bitboards::knight[target] & p[2]) | (bitboards::king[target] & p[7]) |
         (bitboards::lookup(target, state.occupied, false) & (p[4] | p[6])) |
         (bitboards::lookup(target, state.occupied, true) & (p[3] | p[6]));
}
// Force the initial move, then alternate least-valuable LEGAL recaptures on the
// same square. Recompute x-rays each time; back-propagation lets either side
// stop. This is material-only SEE, not a search for checks or off-square
// tactics.
int staticExchange(Move m) {
  int k = kind(m), f = from(m), t = to(m), side = ci(pos.side);
  if (k != 1 && k != 5 && !promo(m))
    return 0;
  int moving = std::abs(pos.b[f]), captured = k == 5 ? t + pos.side * 8 : t;
  int victim = std::abs(pos.b[captured]), placed = promo(m) ? promo(m) : moving;
  ExchangeState state{};
  std::memcpy(state.pieces, pos.pieces, sizeof(state.pieces));
  state.king[0] = pos.king[0];
  state.king[1] = pos.king[1];
  U64 fromBit = U64(1) << f, targetBit = U64(1) << t;
  state.occupied =
      (pos.occupied[0] | pos.occupied[1]) & ~fromBit & ~(U64(1) << captured);
  state.occupied |= targetBit;
  state.pieces[side][moving] &= ~fromBit;
  if (victim)
    state.pieces[1 - side][victim] &= ~(U64(1) << captured);
  state.pieces[side][placed] |= targetBit;
  if (moving == 7)
    state.king[side] = t;
  int gain[65], depth = 0;
  gain[0] =
      values[1][victim] + (promo(m) ? values[1][placed] - values[1][1] : 0);
  int occupant = placed, occupantSide = side;
  side = 1 - side;
  while (occupant != 7 && depth < 64) {
    U64 attackers = exchangeAttackers(state, t, side);
    if (!attackers)
      break;
    bool found = false;
    int nextPiece = 0, promotionGain = 0;
    // Kings are last despite their zero evaluation material value.
    for (int id : {1, 2, 3, 4, 6, 7}) {
      U64 candidates = attackers & state.pieces[side][id];
      while (candidates) {
        int source = __builtin_ctzll(candidates);
        candidates &= candidates - 1;
        ExchangeState next = state;
        int promoted = id == 1 && t / 8 == (side == 0 ? 0 : 7) ? 6 : id;
        next.pieces[occupantSide][occupant] &= ~targetBit;
        next.pieces[side][id] &= ~(U64(1) << source);
        next.pieces[side][promoted] |= targetBit;
        next.occupied &= ~(U64(1) << source);
        if (id == 7)
          next.king[side] = t;
        // Reject pinned recaptures and king captures onto defended squares.
        if (exchangeAttackers(next, next.king[side], 1 - side))
          continue;
        state = next;
        nextPiece = promoted;
        promotionGain =
            promoted != id ? values[1][promoted] - values[1][id] : 0;
        found = true;
        break;
      }
      if (found)
        break;
    }
    if (!found)
      break;
    gain[depth + 1] = values[1][occupant] + promotionGain - gain[depth];
    depth++;
    occupant = nextPiece;
    occupantSide = side;
    side = 1 - side;
  }
  while (depth > 0) {
    gain[depth - 1] = -std::max(-gain[depth - 1], gain[depth]);
    depth--;
  }
  return gain[0];
}
int priority(Move m, Move preferred, int ply) {
  if (m == preferred)
    return 2000000;
  int k = kind(m), victim = k == 2   ? pos.b[(from(m) + to(m)) / 2]
                            : k == 5 ? -pos.side
                                     : pos.b[to(m)];
  if (k == 1 || k == 2 || k == 5 || promo(m)) {
    int base = 100000;
#if MERLIN_SEE_ORDERING
    // If the captured value already covers the moving piece, stopping after
    // one recapture cannot lose material. Avoid SEE where the sign is certain.
    int attacker = std::abs(pos.b[from(m)]);
    if (!promo(m) && values[1][std::abs(victim)] < values[1][attacker] &&
        staticExchange(m) < 0)
      base = -100000;
#elif MERLIN_RECAPTURE_ORDERING
    if (riskyCapture(m))
      base = -100000;
#endif
    return base + 10 * values[pos.normal][std::abs(victim)] +
           values[pos.normal][promo(m)] -
           values[pos.normal][std::abs(pos.b[from(m)])];
  }
  if (m == killers[ply][0])
    return 90000;
  if (m == killers[ply][1])
    return 80000;
  return history[ci(pos.side)][from(m)][to(m)];
}
void order(List &l, Move preferred, int ply) {
  int scores[MAXMOVES];
  for (int i = 0; i < l.n; i++)
    scores[i] = priority(l.m[i], preferred, ply);
  for (int i = 1; i < l.n; i++) {
    Move m = l.m[i];
    int s = scores[i], j = i;
    while (j > 0 && scores[j - 1] < s) {
      l.m[j] = l.m[j - 1];
      scores[j] = scores[j - 1];
      j--;
    }
    l.m[j] = m;
    scores[j] = s;
  }
}
int search(int depth, int alpha, int beta, int ply, int extensions,
           int qp = 0) {
  nodes++;
  if (timeUp())
    return 0;
  bool check = !safe(pos.side);
  if (ply >= MAXPLY - 1)
    return check ? 0 : eval();
  // Search-path repetition only; the UI currently does not supply pre-root
  // history.
  U64 repetitionKey = pos.hash ^ clockKeys[std::min(150, pos.clock)];
  for (int p = ply - 2; p >= 0; p -= 2)
    if (path[p] == repetitionKey)
      return 0;
  path[ply] = repetitionKey;
  if (check && depth > 0 && extensions < 2) {
    depth++;
    extensions++;
  }
  bool quiet = depth <= 0;
  if (quiet)
    qnodes++;
  List moves;
  generate(moves);
  if (!moves.n)
    return check ? -MATE + ply : 0;
  if (drawn())
    return 0;
  if (quiet && !check) {
    int stand = eval();
    if (stand >= beta)
      return stand;
    if (stand > alpha)
      alpha = stand;
    if (qp >= 8)
      return stand;
    List captures;
    for (int i = 0; i < moves.n; i++) {
      Move m = moves.m[i];
      if (kind(m) == 1 || kind(m) == 2 || kind(m) == 5 || promo(m))
        captures.add(m);
    }
    moves = captures;
  }
  // Forced evasions continue beyond the capture budget, bounded by MAXPLY.
  int original = alpha;
  Move preferred = 0, best = 0;
  auto &entry = tt[pos.hash & (tt.size() - 1)];
  // Extension allowance is part of the search state; don't reuse scores across
  // it.
  U64 key = pos.hash ^ stateKeys[256 + extensions];
  if (!quiet && entry.hash == key) {
    preferred = entry.best;
    if (entry.depth >= depth && ply > 0) {
      int score = entry.score;
      if (score > MATE - MAXPLY)
        score -= ply;
      if (score < -MATE + MAXPLY)
        score += ply;
      if (entry.bound == 0)
        return score;
      if (entry.bound == 1 && score >= beta)
        return score;
      if (entry.bound == 2 && score <= alpha)
        return score;
    }
  }
  order(moves, preferred, ply);
  int bestScore = quiet && !check ? alpha : -INF;
  for (int i = 0; i < moves.n; i++) {
    Move m = moves.m[i];
    auto u = make(m);
    int score;
    if (!quiet && i > 0) {
      score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, extensions, qp);
      if (score > alpha && score < beta)
        score = -search(depth - 1, -beta, -alpha, ply + 1, extensions, qp);
    } else
      score = -search(depth - 1, -beta, -alpha, ply + 1, extensions,
                      quiet ? qp + 1 : 0);
    unmake(u);
    if (stopped)
      return 0;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
    if (score > alpha) {
      alpha = score;
      if (ply == 0)
        bestOut = m;
    }
    if (alpha >= beta) {
      if (!quiet && kind(m) == 0 && !promo(m)) {
        recordKiller(m, ply);
        auto &h = history[ci(pos.side)][from(m)][to(m)];
        h = std::min(70000, h + depth * depth);
      }
      break;
    }
  }
  if (!quiet) {
    int stored = bestScore;
    if (stored > MATE - MAXPLY)
      stored += ply;
    if (stored < -MATE + MAXPLY)
      stored -= ply;
    entry = {key, stored, best, int16_t(depth),
             uint8_t(bestScore <= original ? 2
                     : bestScore >= beta   ? 1
                                           : 0)};
  }
  return bestScore;
}
extern "C" {
int *merlin_input() { return input; }
int merlin_see(int packed) { return staticExchange(Move(packed)); }
void merlin_load() {
  pos = Position{};
  pos.normal = input[65];
  pos.side = input[64];
  pos.rights = input[66];
  pos.castled = input[67];
  pos.ep = input[68];
  pos.clock = input[69];
  for (int i = 0; i < 64; i++) {
    setSquare(i, input[i]);
    if (std::abs(input[i]) == 7)
      pos.king[ci(color(input[i]))] = i;
  }
  pos.hash ^= stateHash();
}
void merlin_init() {
  bitboards::init();
  for (auto &row : keys)
    for (auto &x : row)
      x = random64();
  for (auto &x : stateKeys)
    x = random64();
  for (auto &x : clockKeys)
    x = random64();
  sideKey = random64();
  for (int id = 1; id <= 7; id++)
    for (int sq = 0; sq < 64; sq++) {
      int r = sq / 8, c = sq % 8;
      double center = 3.5 - std::max(std::abs(r - 3.5), std::abs(c - 3.5)),
             advance = std::clamp(6 - r, 0, 5), mg = 0, eg = 0;
      switch (id) {
      case 1:
        mg = advance + center * .5;
        eg = advance * 2;
        break;
      case 2:
        mg = (r < 7 ? 4 : 0) + center * 2;
        eg = center * 2;
        break;
      case 3:
        mg = (r < 7 ? 4 : 0) + center * 1.5;
        eg = center * 1.5;
        break;
      case 4:
      case 5:
        mg = (r < 7 ? 2 : 0) + (r == 1 ? 3 : 0);
        eg = advance * .5 + center * .5;
        break;
      case 6:
        mg = -advance * 1.5;
        eg = center * 1.5;
        break;
      case 7:
        mg = -((7 - r) + std::min(std::abs(c - 2), std::abs(c - 6))) * 1.5;
        eg = kingEnd[sq];
      }
      pst[0][id][sq] = mg;
      pst[1][id][sq] = eg;
    }
}
int merlin_search(int milliseconds, int maxDepth) {
  tt.fill(Entry{});
  std::memset(killers, 0, sizeof(killers));
  std::memset(history, 0, sizeof(history));
  nodes = qnodes = 0;
  completed = 0;
  stopped = false;
  start = std::chrono::steady_clock::now();
  deadline = start + std::chrono::milliseconds(milliseconds);
  List root;
  generate(root);
  bestOut = root.n ? root.m[0] : 0;
  int last = bestOut;
  if (!drawn())
    for (int d = 1; d <= std::min(32, maxDepth); d++) {
      int score = search(d, -INF, INF, 0, 0);
      if (stopped) {
        bestOut = last;
        break;
      }
      last = bestOut;
      scoreOut = score;
      completed = d;
      if (std::abs(score) > MATE - MAXPLY)
        break;
    }
  else
    bestOut = 0;
  elapsed = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - start)
                .count();
  return bestOut;
}
int merlin_moves() {
  List l;
  generate(l);
  for (int i = 0; i < l.n; i++)
    input[i] = l.m[i];
  return l.n;
}
double merlin_stat(int i) {
  // Keep signed scores out of a conditional expression with unsigned node
  // counts.
  switch (i) {
  case 0:
    return double(nodes);
  case 1:
    return completed;
  case 2:
    return elapsed;
  case 3:
    return scoreOut;
  default:
    return double(qnodes);
  }
}
uint64_t perft(int d) {
  if (!d)
    return 1;
  List l;
  generate(l);
  uint64_t n = 0;
  for (int i = 0; i < l.n; i++) {
    auto u = make(l.m[i]);
    n += perft(d - 1);
    unmake(u);
  }
  return n;
}
double merlin_perft(int d) { return double(perft(d)); }
}
