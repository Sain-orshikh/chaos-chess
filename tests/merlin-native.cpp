// Internal invariants, independent of the JavaScript move-generation oracle.
#include "../engine/merlin/merlin.cpp"
#include <cassert>
#include <iostream>
void verify() {
  Position saved = pos;
  pos.hash = 0;
  pos.mg = pos.eg = 0;
  pos.material = pos.phase = 0;
  std::memset(pos.b, 0, sizeof(pos.b));
  std::memset(pos.occupied, 0, sizeof(pos.occupied));
  std::memset(pos.pieces, 0, sizeof(pos.pieces));
  for (int sq = 0; sq < 64; sq++)
    setSquare(sq, saved.b[sq]);
  pos.hash ^= stateHash();
  assert(pos.hash == saved.hash);
  assert(std::memcmp(pos.pieces, saved.pieces, sizeof(pos.pieces)) == 0);
  assert(std::memcmp(pos.occupied, saved.occupied, sizeof(pos.occupied)) == 0);
  assert(std::abs(pos.mg - saved.mg) < 1e-9);
  assert(std::abs(pos.eg - saved.eg) < 1e-9);
  assert(pos.material == saved.material && pos.phase == saved.phase);
  pos = saved;
}
void audit(int depth) {
  verify();
  if (!depth)
    return;
  Position before = pos;
  List list;
  generate(list);
  for (int i = 0; i < list.n; i++) {
    Undo undo = make(list.m[i]);
    audit(depth - 1);
    unmake(undo);
    verify();
    assert(pos.hash == before.hash);
    assert(std::memcmp(pos.b, before.b, sizeof(pos.b)) == 0);
  }
}
int main() {
  merlin_init();
  scoreOut = -123;
  assert(merlin_stat(3) == -123);
  // Duplicate updates keep the second distinct move; an older killer promotes.
  Move a = move(52, 44), b = move(51, 43), c = move(50, 42);
  std::memset(killers, 0, sizeof(killers));
  recordKiller(a, 3);
  recordKiller(b, 3);
  recordKiller(b, 3);
  assert(killers[3][0] == b && killers[3][1] == a);
  recordKiller(a, 3);
  assert(killers[3][0] == a && killers[3][1] == b);
  recordKiller(c, 3);
  recordKiller(0, 3);
  assert(killers[3][0] == c && killers[3][1] == a);
  recordKiller(b, 4);
  assert(killers[3][0] == c && killers[4][0] == b);
  auto setup = [](std::initializer_list<std::pair<int, int>> pieces) {
    std::memset(input, 0, sizeof(input));
    input[64] = 1;
    input[65] = 1;
    input[68] = -1;
    for (auto [square, piece] : pieces)
      input[square] = piece;
    merlin_load();
  };
  // Qxe5 vacates d4, revealing c3's bishop recapture through that square.
  setup({{63, 7}, {7, -7}, {35, 6}, {28, -1}, {42, -3}});
  Move capture = move(35, 28, 1);
  assert(!attacked(28, 1, pos.occupied[0] | pos.occupied[1]));
  Position beforeRisk = pos;
  assert(riskyCapture(capture));
  assert(staticExchange(capture) == -800);
  assert(std::memcmp(&beforeRisk, &pos, sizeof(pos)) == 0);
  assert(priority(capture, capture, 0) == 2000000); // Cached move always first.
#if MERLIN_RECAPTURE_ORDERING || MERLIN_SEE_ORDERING
  assert(priority(capture, 0, 0) < 0);
#endif
  setup({{63, 7}, {7, -7}, {35, 6}, {28, -1}});
  assert(!riskyCapture(capture)); // An undefended pawn isn't a "bad" capture.
  setup({{63, 7}, {7, -7}, {35, 1}, {28, -6}, {42, -3}});
  assert(
      !riskyCapture(capture)); // Winning a queen stays high even if recaptured.
  setup({{63, 7}, {7, -7}, {9, 1}, {0, -4}, {16, -4}});
  assert(!riskyCapture(move(9, 0, 1, 6))); // Don't demote promotions.
  std::cout << "Distinct killer updates and recapture ordering tests passed.\n";
  unsigned verified = 0;
  uint64_t random = 0x7341bca2406f918dULL;
  for (bool diagonal : {false, true})
    for (int sq = 0; sq < 64; sq++) {
      U64 mask = sliders::relevant(sq, diagonal), subset = 0;
      do {
        assert(bitboards::lookup(sq, subset, diagonal) ==
               sliders::ray(sq, subset, diagonal));
        verified++;
        subset = (subset - mask) & mask;
      } while (subset);
      for (int i = 0; i < 1000; i++) {
        random ^= random << 13;
        random ^= random >> 7;
        random ^= random << 17;
        assert(bitboards::lookup(sq, random, diagonal) ==
               sliders::ray(sq, random, diagonal));
      }
    }
  assert(verified == 107648);
  std::cout << "Verified all 107648 blocker subsets plus 128000 arbitrary "
               "occupancies.\n";
  // King tables match the reference image and mirror ranks for Black.
  assert(pst[1][7][27] == 45 && pst[1][7][60] == -30);
  for (int normal : {1}) {
    std::memset(input, 0, sizeof(input));
    input[64] = 1;
    input[65] = normal;
    input[66] = 15;
    input[68] = -1;
    input[60] = 7;
    input[4] = -7;
    input[56] = 4;
    input[63] = 4;
    input[0] = -4;
    input[7] = -4;
    input[9] = 1;
    input[54] = -1;
    input[27] = 3;
    input[36] = -2;
    merlin_load();
    audit(3);
    // Tapered king score reaches the endgame map without heavy pieces.
    std::memset(input, 0, 64 * sizeof(int));
    input[27] = 7;
    input[7] = -7;
    merlin_load();
    assert(eval() == 95);
    // At starting non-pawn material, opening weight is exactly one.
    pos.phase = normal ? 6400 : 6000;
    assert(eval() == int(pos.mg));
    pos.phase /= 2;
    assert(eval() == int((pos.mg + pos.eg) / 2));
  }
  std::cout << "Incremental hash/evaluation, undo, castling, promotions, "
               "bitboards, and king-map blend passed.\n";
}
