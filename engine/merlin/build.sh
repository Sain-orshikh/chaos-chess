#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Benchmark variants can override switches/output without editing production code.
read -r -a merlin_flags <<< "${MERLIN_CXXFLAGS:-}"
"${EMXX:-em++}" "${merlin_flags[@]}" engine/merlin/merlin.cpp -std=c++17 -O3 -flto --no-entry -sEXPORTED_RUNTIME_METHODS=HEAP32 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=2097152 -sEXPORTED_FUNCTIONS='["_merlin_init","_merlin_input","_merlin_load","_merlin_search","_merlin_moves","_merlin_stat","_merlin_perft","_merlin_see"]' -o "${MERLIN_OUTPUT:-public/engines/merlin.js}"
