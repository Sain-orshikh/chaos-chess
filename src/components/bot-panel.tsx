"use client";

import { useEffect, useState } from "react";
import type { BotMessage, BotReport, BotResult, BotSettings } from "./common/bot_search";
import type { BasicMove, Board, Color, CastlingState } from "./utils/types";
import { defaultBotSettings } from "./common/bot_search";

type Props = {
    board: Board; castling: CastlingState; turn: Color; active: boolean; finished: boolean;
    settings: BotSettings; onSettings: (settings: BotSettings) => void;
    onMove: (move: BasicMove, board: Board, turn: Color) => void;
};

export default function BotPanel({ board, castling, turn, active, finished, settings, onSettings, onMove }: Props) {
    // Stable for every turn/depth in this game; a restart remounts this panel with a new seed.
    const [evaluationSeed] = useState(() => 1 + Math.floor(Math.random() * 0xffffffff));
    const [report, setReport] = useState<BotReport | null>(null);
    const [result, setResult] = useState<BotResult | null>(null);
    const [failure, setFailure] = useState<{ board: Board; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const error = failure?.board === board ? failure.message : "";
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let worker: Worker | undefined;
        function fail(message: string) { if (!cancelled) setFailure({ board, message }); }
        try {
            worker = new Worker(new URL("../workers/bot.worker.ts", import.meta.url), { type: "module" });
            const current = worker;
            current.onmessage = (event: MessageEvent<BotMessage>) => {
                if (cancelled) return;
                const message = event.data;
                if (message.type === "progress") { setReport(message.report); setResult(null); }
                if (message.type === "error") { fail(message.message); current.terminate(); }
                if (message.type === "result") {
                    setReport(message.result); setResult(message.result); current.terminate();
                    if (message.result.move) onMove(message.result.move, board, turn);
                    else fail("No move was returned. Restart the game or retry the search.");
                }
            };
            current.onerror = () => { fail("The bot could not finish its search. Try again."); current.terminate(); };
            current.postMessage({ board, castling, turn, settings: { ...settings, mode: defaultBotSettings.mode, quiescence: true }, evaluationSeed });
        } catch {
            queueMicrotask(() => fail("The background search could not start. Try again."));
        }
        return () => { cancelled = true; worker?.terminate(); };
    }, [active, board, castling, turn, settings, retry, onMove, evaluationSeed]);
    function change<K extends keyof BotSettings>(key: K, value: BotSettings[K]) {
        setFailure(null);
        onSettings({ ...settings, [key]: value });
    }
    const stats = report?.stats;
    const status = finished ? "Game over" : error ? "Search interrupted" : active ? `Rooke is thinking${report ? ` · depth ${report.searchingDepth}` : "…"}` : "Your turn";
    return <aside className="bot-panel lab-configuration" aria-label="Bot controls and statistics">
        <div className="bot-panel-heading"><h2>Rooke</h2><span>Current engine · unrated</span></div>
        <p role="status" className="bot-status">{status}</p>
        <fieldset disabled={active && !error}>
            <legend className="sr-only">Bot search settings</legend>
            <div className="bot-options">
                <label className="lab-field">Maximum depth<select value={settings.maxDepth} onChange={e => change("maxDepth", Number(e.target.value))}>{Array.from({ length: 16 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} {value === 1 ? "ply" : "plies"}</option>)}</select></label>
                <label className="lab-field">Time per move<select value={settings.maxTimeMs} onChange={e => change("maxTimeMs", Number(e.target.value))}>{[100, 500, 1000, 3000, 5000, 10000].map(value => <option key={value} value={value}>{value < 1000 ? `${value} ms` : `${value / 1000} s`}</option>)}</select></label>
            </div>
            <details className="bot-advanced"><summary>Search extensions</summary>
            <div className="bot-options bot-extensions">
                <label className="lab-field">Capture extension<select value={settings.maxQuiescencePly} onChange={e => change("maxQuiescencePly", Number(e.target.value))}>{[0, 1, 2, 4, 6, 8, 12, 16].map(value => <option key={value} value={value}>{value} {value === 1 ? "ply" : "plies"}</option>)}</select></label>
                <label className="lab-field">Extra check escapes<select value={settings.maxCheckEvasionPly} onChange={e => change("maxCheckEvasionPly", Number(e.target.value))}>{[0, 2, 4, 8, 12, 16].map(value => <option key={value} value={value}>{value} plies</option>)}</select></label>
            </div>
            </details>
        </fieldset>
        <p className="bot-help">Settings apply to the next bot turn. Searches depth 1 upward within one time budget; plays the last completed depth.</p>
        {error && <div><p role="alert" className="form-error">{error}</p><button type="button" className="quiet-button" onClick={() => { setFailure(null); setRetry(value => value + 1); }}>Retry search</button></div>}
        <h3>Latest bot search</h3>
        <dl className="bot-stats">
            {([
                ["Search time", stats ? `${stats.elapsedMs.toFixed(1)} ms` : "—"],
                ["Completed depth", report ? `${report.completedDepth} / ${report.requestedDepth}` : "—"],
                ["Positions visited", stats?.positionsVisited.toLocaleString() ?? "—"],
                ["Positions evaluated", stats?.positionsEvaluated.toLocaleString() ?? "—"],
                ["Alpha-beta cutoffs", stats?.cutoffs.toLocaleString() ?? "—"],
                ["Quiescence nodes", stats?.quiescenceNodes.toLocaleString() ?? "—"],
                ["Deepest extension", stats ? `${stats.maxQuiescencePlyReached} plies` : "—"],
                ["Legal moves", report?.legalMoves.toLocaleString() ?? "—"],
                ["Move generation", report ? `${(report.generationMs * 1000).toFixed(1)} µs` : "—"],
            ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {result && <p className="bot-help">{result.fallback ? "No depth finished; played a legal fallback move." : `Played the result from depth ${result.completedDepth}.`}{result.limit === "time" ? " Time limit reached." : result.limit === "quiescence" ? " A deeper search hit the check-extension limit." : ""}</p>}
        <p className="bot-help">Counts include all attempted depths and partial searches. Generation is one measurement. Transposition caching is enabled. Rooke’s strength is not Elo calibrated yet.</p>
    </aside>;
}
