// Kestrel: independent Classic/Havoc search core. a8=0; piece IDs match the
// app.
#include "../opening_variation.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
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
void setSquare(int sq, int p) {
  int old = pos.b[sq];
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
bool safe(int s) {
  int k = pos.king[ci(s)], r = k / 8, c = k % 8;
  if (k < 0)
    return false;
  for (int i = 0; i < 8; i++) {
    int rr = r + nr[i], cc = c + nc[i];
    if (on(rr, cc) && pos.b[rr * 8 + cc] == -s * (pos.normal ? 2 : 6))
      return false;
  }
  int pr =
      r + (s == 1 ? -1 : 1); // enemy pawn origin is one rank toward our advance
  if (pos.normal) {
    for (int d : {-1, 1})
      if (on(pr, c + d) && pos.b[pr * 8 + c + d] == -s)
        return false;
  } else {
    if (on(pr, c) && pos.b[pr * 8 + c] == -s)
      return false;
    for (int i = 4; i < 8; i++)
      if (on(r + dr[i], c + dc[i]) && on(r - dr[i], c - dc[i]) &&
          pos.b[(r + dr[i]) * 8 + c + dc[i]] == -s * 3 &&
          pos.b[(r - dr[i]) * 8 + c - dc[i]] == 0)
        return false;
  }
  for (int d = 0; d < 8; d++)
    for (int n = 1; n <= 7; n++) {
      int rr = r + dr[d] * n, cc = c + dc[d] * n;
      if (!on(rr, cc))
        break;
      int p = pos.b[rr * 8 + cc];
      if (!p)
        continue;
      if (color(p) == -s) {
        int id = std::abs(p), range = 0;
        if (id == 7)
          range = 1;
        else if (pos.normal) {
          if (id == 6 || (d < 4 && id == 4) || (d >= 4 && (id == 3 || id == 5)))
            range = 7;
        } else {
          if (id == 2)
            range = 2;
          else if (d < 4 && (id == 4 || id == 6))
            range = 7;
          else if (d >= 4 && id == 5)
            range = 7;
        }
        if (range >= n)
          return false;
      }
      break;
    }
  return true;
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
  for (int i = 0; i < u.n; i++)
    pos.b[u.squares[i]] = u.pieces[i];
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
  int s = pos.side;
  auto add = [&](int f, int t, int k) {
    if (pos.b[t] == -s * 7 || (k == 2 && pos.b[(f + t) / 2] == -s * 7))
      return;
    if (std::abs(pos.b[f]) == 1 && t / 8 == (s == 1 ? 0 : 7)) {
      for (int p : {6, 4, 3, 2})
        candidates.add(move(f, t, k, p));
    } else
      candidates.add(move(f, t, k));
  };
  for (int f = 0; f < 64; f++) {
    int piece = pos.b[f];
    if (color(piece) != s)
      continue;
    int id = std::abs(piece), r = f / 8, c = f % 8;
    if (id == 1) {
      int rr = r - s;
      if (rr >= 0 && rr < 8) {
        if (pos.normal) {
          if (!pos.b[rr * 8 + c]) {
            add(f, rr * 8 + c, 0);
            if (r == (s == 1 ? 6 : 1) && !pos.b[(r - 2 * s) * 8 + c])
              add(f, (r - 2 * s) * 8 + c, 0);
          }
          for (int d : {-1, 1})
            if (on(rr, c + d)) {
              int t = rr * 8 + c + d;
              if (color(pos.b[t]) == -s)
                add(f, t, 1);
              else if (t == pos.ep && !pos.b[t] && r == (s == 1 ? 3 : 4) &&
                       pos.b[r * 8 + c + d] == -s)
                add(f, t, 5);
            }
        } else {
          for (int d : {-1, 1})
            if (on(rr, c + d) && !pos.b[rr * 8 + c + d])
              add(f, rr * 8 + c + d, 0);
          if (color(pos.b[rr * 8 + c]) == -s)
            add(f, rr * 8 + c, 1);
        }
      }
    } else if (!pos.normal && id == 3) {
      for (int d = 4; d < 8; d++) {
        int rr = r + dr[d], cc = c + dc[d];
        if (!on(rr, cc))
          continue;
        int t = rr * 8 + cc;
        if (!pos.b[t])
          add(f, t, 0);
        else if (on(rr + dr[d], cc + dc[d]) &&
                 !pos.b[(rr + dr[d]) * 8 + cc + dc[d]])
          add(f, (rr + dr[d]) * 8 + cc + dc[d], color(pos.b[t]) == -s ? 2 : 0);
      }
    } else {
      for (int d = 0; d < 8; d++) {
        int range = 0;
        if (id == 7)
          range = 1;
        else if (pos.normal) {
          if (id == 6 || (id == 4 && d < 4) || ((id == 3 || id == 5) && d >= 4))
            range = 7;
        } else {
          if (id == 2)
            range = 2;
          else if ((id == 4 || id == 6) && d < 4)
            range = 7;
          else if (id == 5 && d >= 4)
            range = 7;
        }
        for (int n = 1; n <= range; n++) {
          int rr = r + dr[d] * n, cc = c + dc[d] * n;
          if (!on(rr, cc))
            break;
          int t = rr * 8 + cc;
          if (color(pos.b[t]) == s)
            break;
          add(f, t, pos.b[t] ? 1 : 0);
          if (pos.b[t])
            break;
        }
      }
      if ((pos.normal && id == 2) || (!pos.normal && id == 6))
        for (int d = 0; d < 8; d++) {
          int rr = r + nr[d], cc = c + nc[d];
          if (on(rr, cc) && color(pos.b[rr * 8 + cc]) != s)
            add(f, rr * 8 + cc, pos.b[rr * 8 + cc] ? 1 : 0);
        }
    }
    if (!pos.normal && (id == 4 || id == 5))
      candidates.add(move(f, f, 3));
    if (id == 7 && f == (s == 1 ? 60 : 4) && !(pos.castled & (1 << ci(s))) &&
        safe(s))
      for (int dir : {1, -1}) {
        int rf = f + (dir == 1 ? 3 : -4), bit = ci(s) * 2 + (dir == 1 ? 0 : 1);
        if (pos.b[rf] != s * 4 || (pos.normal && !(pos.rights & (1 << bit))))
          continue;
        bool clear = true;
        for (int q = f + dir; q != rf; q += dir)
          if (pos.b[q])
            clear = false;
        if (!clear)
          continue;
        if (pos.normal) {
          Move cross = move(f, f + dir);
          auto u = make(cross);
          bool ok = safe(s);
          unmake(u);
          if (!ok)
            continue;
        }
        candidates.add(move(f, f + dir * 2, 4));
      }
  }
  for (int i = 0; i < candidates.n; i++) {
    Move m = candidates.m[i];
    if (tactical && kind(m) != 1 && kind(m) != 2 && kind(m) != 5 && !promo(m))
      continue;
    auto u = make(m);
    bool ok = safe(s);
    unmake(u);
    if (ok)
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
int priority(Move m, Move preferred, int ply) {
  if (m == preferred)
    return 2000000;
  int k = kind(m), victim = k == 2   ? pos.b[(from(m) + to(m)) / 2]
                            : k == 5 ? -pos.side
                                     : pos.b[to(m)];
  if (k == 1 || k == 2 || k == 5 || promo(m))
    return 100000 + 10 * values[pos.normal][std::abs(victim)] +
           values[pos.normal][promo(m)] -
           values[pos.normal][std::abs(pos.b[from(m)])];
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
int openingCutoff = 0, openingSelectedScore = 0;
uint32_t openingGameSeed = 0;
std::array<int, MAXMOVES> openingScores;

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
  const bool variedRoot = ply == 0 && openingCutoff > 0;
  for (int i = 0; i < moves.n; i++) {
    Move m = moves.m[i];
    auto u = make(m);
    int score;
    if (variedRoot) {
      // Full windows are required: PVS fail-low results are bounds, not scores.
      score = -search(depth - 1, -INF, INF, ply + 1, extensions, 0);
    } else if (!quiet && i > 0) {
      score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, extensions, qp);
      if (score > alpha && score < beta)
        score = -search(depth - 1, -beta, -alpha, ply + 1, extensions, qp);
    } else
      score = -search(depth - 1, -beta, -alpha, ply + 1, extensions,
                      quiet ? qp + 1 : 0);
    unmake(u);
    if (stopped)
      return 0;
    if (variedRoot) openingScores[i] = score;
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
        killers[ply][1] = killers[ply][0];
        killers[ply][0] = m;
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
  if (variedRoot && moves.n) {
    int selected = openingIndex(openingScores.data(), moves.n, openingCutoff,
        openingGameSeed ^ uint32_t(pos.hash) ^ uint32_t(pos.hash >> 32), MATE - MAXPLY);
    bestOut = moves.m[selected];
    openingSelectedScore = openingScores[selected];
  }
  return bestScore;
}
extern "C" {
int *kestrel_input() { return input; }
void kestrel_load() {
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
void kestrel_init() {
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
void kestrel_opening(int cutoff, uint32_t seed) {
  openingCutoff = std::clamp(cutoff, 0, 100);
  openingGameSeed = seed;
}
int kestrel_search(int milliseconds, int maxDepth) {
  tt.fill(Entry{});
  std::memset(killers, 0, sizeof(killers));
  std::memset(history, 0, sizeof(history));
  nodes = qnodes = 0;
  completed = 0;
  scoreOut = 0;
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
      scoreOut = openingCutoff > 0 && root.n ? openingSelectedScore : score;
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
int kestrel_moves() {
  List l;
  generate(l);
  for (int i = 0; i < l.n; i++)
    input[i] = l.m[i];
  return l.n;
}
double kestrel_stat(int i) {
  return i == 0   ? nodes
         : i == 1 ? completed
         : i == 2 ? elapsed
         : i == 3 ? double(scoreOut)
                  : qnodes;
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
double kestrel_perft(int d) { return double(perft(d)); }
}
