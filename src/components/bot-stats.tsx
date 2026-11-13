"use client";

import NavIcon from "./nav-icon";
import type { BotReport, BotResult } from "./common/bot_search";
import type { BasicMove } from "./utils/types";

export type NativeBotResult = {
    move: BasicMove | null; depth: number; nodes: number; elapsedMs: number; score: number; quiescenceNodes: number;
};
const metrics = [
    ["depth", "Completed depth"], ["nodes", "Positions visited"],
    ["quiescenceNodes", "Search nodes (tactical)"], ["score", "Score (bot perspective, cp)"],
] as const;
type Metric = typeof metrics[number][0];
export type BotTelemetry = Partial<Record<Metric, number>> & { outcome?: string };
export function rookeTelemetry(report: BotReport | BotResult): BotTelemetry {
    return { depth: report.completedDepth, nodes: report.stats.positionsVisited,
        quiescenceNodes: report.stats.quiescenceNodes,
        outcome: "limit" in report ? report.fallback ? "First legal move fallback" : report.limit === "time" ? "Time limit reached" : report.limit === "quiescence" ? "Tactical limit reached" : "Search complete" : undefined };
}
export function nativeTelemetry(result: NativeBotResult): BotTelemetry {
    return { depth: result.depth, nodes: result.nodes, score: result.score, quiescenceNodes: result.quiescenceNodes };
}

export default function BotStats({ data, active, live }: { data: BotTelemetry | null; active: boolean; live: boolean }) {
    return <section className="bot-stats" aria-label="Bot search statistics">
        <div className="bot-stats-heading"><NavIcon name="lab" /><div><h2>Bot search · Test mode</h2><p>{active ? live ? "Searching · live progress" : "Searching · stats appear after this move" : data ? `Last bot move · ${data.outcome ?? "Search complete"}` : "Waiting for the bot’s first move"}</p></div></div>
        <dl>{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{data?.[key] === undefined ? data ? "Unavailable" : "—" : data[key].toLocaleString(undefined, { maximumFractionDigits: 0, signDisplay: key === "score" ? "exceptZero" : "auto" })}</dd></div>)}</dl>
        <p className="bot-stats-note">Positive scores favor the bot; negative scores favor you. 100 cp = 1 pawn. Tactical nodes are included in positions visited. Rooke does not report a score.</p>
    </section>;
}
