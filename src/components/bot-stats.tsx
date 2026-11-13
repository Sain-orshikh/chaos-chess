"use client";

import { useState } from "react";
import NavIcon from "./nav-icon";
import type { BotReport, BotResult } from "./common/bot_search";
import type { BasicMove } from "./utils/types";

export type NativeBotResult = {
    move: BasicMove | null; depth: number; nodes: number; elapsedMs: number; score: number; quiescenceNodes: number;
};
const metrics = [
    ["depth", "Completed depth"], ["searchingDepth", "Searching depth"],
    ["elapsedMs", "Search time (ms)"], ["nodes", "Positions visited"], ["nps", "Positions / second"],
    ["quiescenceNodes", "Tactical search nodes"], ["positionsEvaluated", "Positions evaluated"],
    ["cutoffs", "Alpha-beta cutoffs"], ["movesExplored", "Moves explored"],
    ["generatedMoves", "Moves generated"], ["movesSkipped", "Moves skipped"],
    ["materialEvaluations", "Material evaluations"], ["terminalPositions", "Terminal positions"],
    ["quiescenceMoves", "Tactical moves"], ["maxQuiescencePlyReached", "Deepest tactical extension"],
    ["quiescenceLimitHits", "Tactical limit hits"], ["legalMoves", "Legal root moves"],
    ["generationMs", "Move generation (ms)"], ["score", "Score (bot perspective, cp)"],
] as const;
type Metric = typeof metrics[number][0];
export type BotTelemetry = Partial<Record<Metric, number>> & { outcome?: string };
function speed(nodes: number, elapsedMs: number) { return elapsedMs > 0 ? Math.round(nodes * 1000 / elapsedMs) : 0; }
export function rookeTelemetry(report: BotReport | BotResult): BotTelemetry {
    return { ...report.stats, depth: report.completedDepth, searchingDepth: report.searchingDepth,
        nodes: report.stats.positionsVisited, nps: speed(report.stats.positionsVisited, report.stats.elapsedMs),
        generationMs: report.generationMs, legalMoves: report.legalMoves,
        outcome: "limit" in report ? report.fallback ? "First legal move fallback" : report.limit === "time" ? "Time limit reached" : report.limit === "quiescence" ? "Tactical limit reached" : "Search complete" : undefined };
}
export function nativeTelemetry(result: NativeBotResult): BotTelemetry {
    return { depth: result.depth, nodes: result.nodes, elapsedMs: result.elapsedMs,
        nps: speed(result.nodes, result.elapsedMs), score: result.score, quiescenceNodes: result.quiescenceNodes };
}

export default function BotStats({ data, active, live }: { data: BotTelemetry | null; active: boolean; live: boolean }) {
    const [hidden, setHidden] = useState<Metric[]>([]);
    return <section className="bot-stats" aria-label="Bot search statistics">
        <div className="bot-stats-heading"><NavIcon name="lab" /><div><h2>Bot search · Test mode</h2><p>{active ? live ? "Searching · live progress" : "Searching · stats appear after this move" : data ? `Last bot move · ${data.outcome ?? "Search complete"}` : "Waiting for the bot’s first move"}</p></div></div>
        <details><summary>Choose statistics</summary><div className="bot-stat-options">{metrics.map(([key, label]) => <label key={key}><input type="checkbox" checked={!hidden.includes(key)} onChange={event => setHidden(previous => event.target.checked ? previous.filter(item => item !== key) : [...previous, key])} />{label}</label>)}</div></details>
        <dl>{metrics.filter(([key]) => !hidden.includes(key)).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{data?.[key] === undefined ? data ? "Unavailable" : "—" : data[key].toLocaleString(undefined, { maximumFractionDigits: key.endsWith("Ms") ? 1 : 0 })}</dd></div>)}</dl>
        <p className="bot-stats-note">Depth counts individual player moves. Tactical search can look further. Counts include repeated positions. Unavailable means this engine does not report that statistic.</p>
    </section>;
}
