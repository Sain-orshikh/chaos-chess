#pragma once
#include <cmath>
#include <cstdint>

// All scores must be exact and from the side-to-move's perspective.
inline int openingIndex(const int *scores, int count, int cutoff, uint32_t seed,
                        int mateThreshold) {
  int best = 0;
  for (int i = 1; i < count; i++)
    if (scores[i] > scores[best]) best = i;
  if (cutoff <= 0 || std::abs(scores[best]) >= mateThreshold) return best;
  double total = 0;
  for (int i = 0; i < count; i++) {
    int loss = scores[best] - scores[i];
    if (loss <= cutoff) total += cutoff + 1 - loss;
  }
  seed = seed * 1664525u + 1013904223u;
  double ticket = (double(seed) / 4294967296.0) * total;
  for (int i = 0; i < count; i++) {
    int loss = scores[best] - scores[i];
    if (loss <= cutoff) {
      ticket -= cutoff + 1 - loss;
      if (ticket < 0) return i;
    }
  }
  return best;
}
