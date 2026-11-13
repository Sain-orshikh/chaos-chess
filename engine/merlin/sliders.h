#pragma once
#include <cstdint>
namespace sliders {
using Bits = uint64_t;
inline constexpr int rowStep[8] = {-1, 1, 0, 0, -1, -1, 1, 1};
inline constexpr int colStep[8] = {0, 0, -1, 1, -1, 1, -1, 1};
inline bool inside(int r, int c) { return unsigned(r) < 8 && unsigned(c) < 8; }
inline Bits ray(int sq, Bits occupancy, bool diagonal) {
  Bits result = 0;
  for (int d = diagonal ? 4 : 0; d < (diagonal ? 8 : 4); d++) {
    int r = sq / 8 + rowStep[d], c = sq % 8 + colStep[d];
    while (inside(r, c)) {
      Bits bit = Bits(1) << (r * 8 + c);
      result |= bit;
      if (occupancy & bit)
        break;
      r += rowStep[d];
      c += colStep[d];
    }
  }
  return result;
}
inline Bits relevant(int sq, bool diagonal) {
  Bits mask = 0;
  for (int d = diagonal ? 4 : 0; d < (diagonal ? 8 : 4); d++) {
    int r = sq / 8 + rowStep[d], c = sq % 8 + colStep[d];
    while (inside(r + rowStep[d], c + colStep[d])) {
      mask |= Bits(1) << (r * 8 + c);
      r += rowStep[d];
      c += colStep[d];
    }
  }
  return mask;
}
} // namespace sliders
