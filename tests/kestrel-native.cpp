// Internal invariants, independent of the JavaScript move-generation oracle.
#include "../engine/kestrel/kestrel.cpp"
#include <cassert>
#include <iostream>
void verify() {
  Position saved = pos;
  pos.hash = 0;
  pos.mg = pos.eg = 0;
  pos.material = pos.phase = 0;
  std::memset(pos.b, 0, sizeof(pos.b));
  for (int sq = 0; sq < 64; sq++)
    setSquare(sq, saved.b[sq]);
  pos.hash ^= stateHash();
  assert(pos.hash == saved.hash);
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
  kestrel_init();
  // King tables match the reference image and mirror ranks for Black.
  assert(pst[1][7][27] == 45 && pst[1][7][60] == -30);
  for (int normal : {0, 1}) {
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
    kestrel_load();
    audit(3);
    // Tapered king score reaches the endgame map without heavy pieces.
    std::memset(input, 0, 64 * sizeof(int));
    input[27] = 7;
    input[7] = -7;
    kestrel_load();
    assert(eval() == 95);
    // At starting non-pawn material, opening weight is exactly one.
    pos.phase = normal ? 6400 : 6000;
    assert(eval() == int(pos.mg));
    pos.phase /= 2;
    assert(eval() == int((pos.mg + pos.eg) / 2));
  }
  std::cout << "Incremental hash/evaluation, undo, castling, promotions, "
               "rotation, and king-map blend passed.\n";
}
