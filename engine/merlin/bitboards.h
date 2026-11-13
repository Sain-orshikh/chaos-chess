#pragma once
#include "magics.h"
#include "sliders.h"
#include <array>
#include <cstdlib>
namespace bitboards {
using sliders::Bits;
struct Magic {
  Bits mask, factor;
  unsigned shift, offset;
};
inline Magic rook[64], bishop[64];
// Sum of per-square tables: 102400 rook + 5248 bishop entries (841 KiB).
inline std::array<Bits, 107648> attacks{};
inline Bits knight[64], king[64], pawn[2][64], directions[64][8];
inline Bits lookup(int sq, Bits occupied, bool diagonal) {
  const auto &m = diagonal ? bishop[sq] : rook[sq];
  return attacks[m.offset + (((occupied & m.mask) * m.factor) >> m.shift)];
}
inline void init() {
  unsigned offset = 0;
  for (bool diagonal : {false, true})
    for (int sq = 0; sq < 64; sq++) {
      auto &m = diagonal ? bishop[sq] : rook[sq];
      m.mask = sliders::relevant(sq, diagonal);
      m.factor = diagonal ? bishopMagics[sq] : rookMagics[sq];
      m.shift = 64 - __builtin_popcountll(m.mask);
      m.offset = offset;
      unsigned count = 1u << (64 - m.shift);
      std::array<bool, 4096> used{};
      Bits subset = 0;
      do {
        unsigned index = ((subset * m.factor) >> m.shift);
        auto value = sliders::ray(sq, subset, diagonal);
        if (used[index] && attacks[offset + index] != value)
          std::abort();
        used[index] = true;
        attacks[offset + index] = value;
        subset = (subset - m.mask) & m.mask;
      } while (subset);
      offset += count;
    }
  if (offset != attacks.size())
    std::abort();
  constexpr int nr[8] = {-2, -2, -1, -1, 1, 1, 2, 2},
                nc[8] = {-1, 1, -2, 2, -2, 2, -1, 1};
  for (int sq = 0; sq < 64; sq++) {
    int r = sq / 8, c = sq % 8;
    for (int d = 0; d < 8; d++) {
      if (sliders::inside(r + nr[d], c + nc[d]))
        knight[sq] |= Bits(1) << ((r + nr[d]) * 8 + c + nc[d]);
      int rr = r + sliders::rowStep[d], cc = c + sliders::colStep[d];
      if (sliders::inside(rr, cc))
        king[sq] |= Bits(1) << (rr * 8 + cc);
      while (sliders::inside(rr, cc)) {
        directions[sq][d] |= Bits(1) << (rr * 8 + cc);
        rr += sliders::rowStep[d];
        cc += sliders::colStep[d];
      }
    }
    for (int side = 0; side < 2; side++)
      for (int dc : {-1, 1})
        if (sliders::inside(r + (side ? 1 : -1), c + dc))
          pawn[side][sq] |= Bits(1) << ((r + (side ? 1 : -1)) * 8 + c + dc);
  }
}
} // namespace bitboards
