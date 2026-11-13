#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
"${EMXX:-em++}" engine/kestrel/kestrel.cpp -std=c++17 -O3 -flto --no-entry -sEXPORTED_RUNTIME_METHODS=HEAP32 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=2097152 -sEXPORTED_FUNCTIONS='["_kestrel_init","_kestrel_input","_kestrel_load","_kestrel_search","_kestrel_opening","_kestrel_moves","_kestrel_stat","_kestrel_perft"]' -o public/engines/kestrel.js
