import type { TranspositionEntry } from "./types";

// Create one instance per bot/match and retain it between searches.
export function createTranspositionTable() {
    const entries = new Map<bigint, TranspositionEntry>();

    function store(entry: TranspositionEntry): void {
        const previous = entries.get(entry.hash);
        if (previous) {
            if (previous.depth > entry.depth) return;
            if (previous.depth === entry.depth && previous.bound === "exact" && entry.bound !== "exact") return;
        }
        entries.set(entry.hash, entry);
    }

    function lookup(hash: bigint): TranspositionEntry | undefined {
        return entries.get(hash);
    }

    function clear(): void {
        entries.clear();
    }

    return { store, lookup, clear };
}
