"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icon";
import { BoardPiece } from "./piece";
import { benchmarkPositions, parseBenchmarkFen } from "./common/benchmark_positions";
import type { BenchmarkPosition } from "./common/benchmark_positions";
import type { BenchmarkMessage, BenchmarkRequest, BenchmarkResult } from "./common/benchmark";
import { DEFAULT_MAX_QUIESCENCE_PLY } from "./common/engine";
import { defaultBotSettings } from "./common/bot_search";
import type { BasicMove } from "./utils/types";
import { pieceColor, pieceDefinition } from "./utils/pieces";

const integer = (value: number) => value.toLocaleString();
function time(value: number) { return value < 1000 ? `${value.toFixed(2)} ms` : `${(value / 1000).toFixed(2)} s`; }
function squareName(square: number) { return `${"abcdefgh"[square % 8]}${8 - Math.floor(square / 8)}`; }
function moveName(move: BasicMove | null) {
    if (!move) return "No legal move";
    if (move.kind === "rotate") return `${squareName(move.from)} · rotate`;
    if (move.kind === "castle") return `${squareName(move.from)} → ${squareName(move.to)} · castle`;
    return `${squareName(move.from)} → ${squareName(move.to)}${move.promotion ? ` = ${move.promotion}` : ""}`;
}
type Progress = Extract<BenchmarkMessage, { type: "progress" }>;

export default function EngineLab() {
    const [position, setPosition] = useState<BenchmarkPosition>(() => parseBenchmarkFen(benchmarkPositions[0].fen));
    const [preset, setPreset] = useState<string>(benchmarkPositions[0].id);
    const [fen, setFen] = useState<string>(benchmarkPositions[0].fen);
    const [flipped, setFlipped] = useState(false);
    const [depth, setDepth] = useState(defaultBotSettings.maxDepth);
    const [repetitions, setRepetitions] = useState(3);
    const [limit, setLimit] = useState(defaultBotSettings.maxTimeMs);
    const [maxQuiescencePly, setMaxQuiescencePly] = useState(DEFAULT_MAX_QUIESCENCE_PLY);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("Ready to benchmark");
    const [progress, setProgress] = useState<Progress | null>(null);
    const [generation, setGeneration] = useState<{ microseconds: number; legalMoves: number } | null>(null);
    const [results, setResults] = useState<BenchmarkResult[]>([]);
    const [highlight, setHighlight] = useState<BasicMove | null>(null);
    const [runDescription, setRunDescription] = useState("");
    const worker = useRef<Worker | null>(null);
    const latest = useRef<Progress | null>(null);
    useEffect(() => () => { worker.current?.terminate(); }, []);

    function loadPosition(nextFen: string, nextPreset: string) {
        try {
            const next = parseBenchmarkFen(nextFen);
            setPosition(next); setFen(next.fen); setPreset(nextPreset);
            setResults([]); setGeneration(null); setHighlight(null); setProgress(null);
            latest.current = null; setError(""); setStatus("Ready to benchmark");
        } catch (e) { setError(e instanceof Error ? e.message : "Invalid position."); }
    }
    function stop() {
        worker.current?.terminate(); worker.current = null;
        const active = latest.current;
        if (active) setResults(previous => [...previous, {
            mode: active.mode, depth: active.depth, status: "stopped", stats: active.stats,
            medianMs: null, samplesMs: [], move: null,
        }]);
        setBusy(false); setProgress(null); latest.current = null;
        setStatus(active ? "Stopped. Completed measurements are kept; the last row contains partial counts." : "Benchmark stopped.");
    }
    function run() {
        setError("");
        if (fen.trim() !== position.fen) { setError("Load your edited FEN before starting the benchmark."); return; }
        const request: BenchmarkRequest = { fen: position.fen, modes: [defaultBotSettings.mode], maxDepth: depth, repetitions, timeLimitMs: limit, quiescence: true, maxQuiescencePly };
        try {
            const current = new Worker(new URL("../workers/benchmark.worker.ts", import.meta.url), { type: "module" });
            worker.current = current;
            setResults([]); setGeneration(null); setHighlight(null); setProgress(null);
            latest.current = null; setBusy(true); setStatus("Measuring legal move generation…");
            setRunDescription(`Depths 1–${depth} · ${repetitions} ${repetitions === 1 ? "trial" : "trials"} per depth · ${limit / 1000}s limit per trial · capture extension ${maxQuiescencePly} plies`);
            current.onmessage = (event: MessageEvent<BenchmarkMessage>) => {
                if (worker.current !== current) return;
                const message = event.data;
                if (message.type === "generation") setGeneration(message);
                if (message.type === "progress") {
                    latest.current = message; setProgress(message);
                    setStatus(`Depth ${message.depth} · trial ${message.trial} of ${repetitions}`);
                }
                if (message.type === "result") {
                    setResults(previous => [...previous, message.result]);
                    if (message.result.status === "complete") setHighlight(message.result.move);
                    latest.current = null;
                }
                if (message.type === "done" || message.type === "error") {
                    current.terminate(); worker.current = null;
                    setBusy(false); setProgress(null); latest.current = null;
                    setStatus(message.type === "done" ? "Benchmark finished" : "Benchmark interrupted");
                    if (message.type === "error") setError(message.message);
                }
            };
            current.onerror = () => {
                if (worker.current !== current) return;
                current.terminate(); worker.current = null; latest.current = null;
                setBusy(false); setProgress(null); setStatus("Benchmark interrupted");
                setError("The background search could not run. Reload the page and try again.");
            };
            current.postMessage(request);
        } catch (e) {
            worker.current?.terminate(); worker.current = null; setBusy(false);
            setError(e instanceof Error ? e.message : "Your browser could not start the background search.");
        }
    }
    const shownStats = progress?.stats ?? results.at(-1)?.stats;
    const pieces = position.board.filter(Boolean).length;
    return <section className="engine-lab">
        <div className="page-heading"><h1>Engine lab</h1><span className="lab-eyebrow">Measure. Compare. Improve.</span></div>
        <p className="lab-intro">Test the current engine across positions, depths, and time limits.</p>
        <div className="lab-layout">
            <div className="lab-position">
                <div className="lab-board-header"><div><strong>{preset === "custom" ? "Custom position" : benchmarkPositions.find(item => item.id === preset)?.name}</strong><span>{position.turn === "white" ? "White" : "Black"} to move · {pieces} pieces</span></div><button className="quiet-button" type="button" onClick={() => setFlipped(value => !value)} aria-label="Flip board"><Icon name="replay" />Flip</button></div>
                <div className="board-frame"><div className="chess-grid lab-board" role="img" aria-label={`Position preview, ${position.turn} to move, ${pieces} pieces`}>
                    {Array.from({ length: 64 }, (_, index) => {
                        const row = flipped ? 7 - Math.floor(index / 8) : Math.floor(index / 8);
                        const col = flipped ? 7 - index % 8 : index % 8;
                        const square = row * 8 + col, piece = position.board[square];
                        return <div key={square} className={`board-square ${(row + col) % 2 ? "dark" : "light"}${highlight && (highlight.from === square || highlight.to === square) ? " latest" : ""}`} aria-label={`${squareName(square)} ${piece ? `${pieceColor(piece)} ${pieceDefinition(piece)!.label}` : "empty"}`}>
                            {index % 8 === 0 && <span className="coordinate rank">{8 - row}</span>}
                            {index >= 56 && <span className="coordinate file">{"abcdefgh"[col]}</span>}
                            <BoardPiece code={piece} />
                        </div>;
                    })}
                </div></div>
                <div className="lab-generation"><span>All legal moves · generation</span><strong>{generation ? `${generation.microseconds.toFixed(2)} µs` : "—"}</strong><small>{generation ? `${generation.legalMoves} legal moves · median of 3 warmed batches` : "Measured separately before the search"}</small></div>
            </div>
            <div className="lab-configuration">
                <fieldset disabled={busy}>
                    <legend className="sr-only">Benchmark configuration</legend>
                    <label className="lab-field">Position<select value={preset} onChange={event => {
                        const item = benchmarkPositions.find(item => item.id === event.target.value);
                        if (item) loadPosition(item.fen, item.id);
                        else setPreset("custom");
                    }}>{benchmarkPositions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="custom">Custom FEN</option></select></label>
                    <form onSubmit={event => { event.preventDefault(); loadPosition(fen, "custom"); }}>
                        <label className="lab-field">FEN position<textarea rows={3} spellCheck={false} value={fen} onChange={event => setFen(event.target.value)} aria-describedby="fen-help" /></label>
                        <div className="lab-fen-footer"><small id="fen-help">Chaos Chess rules. Castling and en passant fields are ignored.</small><button className="quiet-button" type="submit">Load FEN</button></div>
                    </form>
                    <div className="lab-options">
                        <label className="lab-field">Maximum depth<select value={depth} onChange={event => setDepth(Number(event.target.value))}>{Array.from({ length: 16 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} {value === 1 ? "ply" : "plies"}</option>)}</select></label>
                        <label className="lab-field">Trials per depth<select value={repetitions} onChange={event => setRepetitions(Number(event.target.value))}><option value={1}>1 · quick test</option><option value={3}>3 · use median</option></select></label>
                        <label className="lab-field">Time limit per trial<select value={limit} onChange={event => setLimit(Number(event.target.value))}>{[1000, 3000, 5000, 10000].map(value => <option key={value} value={value}>{value / 1000} {value === 1000 ? "second" : "seconds"}</option>)}</select></label>
                    </div>
                    <label className="lab-field">Capture extension limit<select value={maxQuiescencePly} onChange={event => setMaxQuiescencePly(Number(event.target.value))}>{[1, 2, 4, 6, 8, 12, 16].map(value => <option key={value} value={value}>{value} extra {value === 1 ? "ply" : "plies"}</option>)}</select></label>
                </fieldset>
                <div className="lab-hashing"><Icon name="shield" /><span><strong>Current engine</strong><small>Move ordering, quiescence, positional evaluation, and transposition caching.</small></span></div>
                {error && <p role="alert" className="form-error">{error}</p>}
                <div className="lab-actions">{busy ? <button type="button" className="primary-button" onClick={stop}><Icon name="close" />Stop benchmark</button> : <button type="button" className="primary-button" onClick={run}><Icon name="play" />Run benchmark</button>}<span>Runs depths 1–{depth}. One ply is one player’s action.</span></div>
            </div>
        </div>
        <div className="lab-results-header"><div><h2>Search results</h2><p role="status">{status}</p></div>{busy && <span className="lab-running">Running</span>}</div>
        <div className="lab-live-stats">
            <div><span>Positions visited</span><strong>{shownStats ? integer(shownStats.positionsVisited) : "—"}</strong></div>
            <div><span>Positions evaluated</span><strong>{shownStats ? integer(shownStats.positionsEvaluated) : "—"}</strong></div>
            <div><span>Alpha-beta cutoffs</span><strong>{shownStats ? integer(shownStats.cutoffs) : "—"}</strong></div>
        </div>
        {results.length > 0 ? <>
            <p className="lab-run-description">{runDescription}</p>
            <div className="lab-table-scroll"><table className="lab-table"><caption className="sr-only">Current engine benchmark results by depth</caption><thead><tr><th>Depth</th><th>Search time</th><th>Visited</th><th>Evaluated</th><th>Cutoffs</th><th>Q nodes</th><th>Best move</th></tr></thead><tbody>{results.map(result => <tr key={`${result.mode}-${result.depth}`}>
                <td><strong>Depth {result.depth}</strong>{result.status !== "complete" && <small>{result.status === "timed-out" ? "time limit" : result.status === "extension-limit" ? "extension limit in check" : "stopped"}</small>}</td>
                <td>{result.medianMs !== null ? time(result.medianMs) : <span className="lab-partial">Incomplete</span>}</td>
                <td>{integer(result.stats.positionsVisited)}{result.status !== "complete" && <small>partial</small>}</td>
                <td>{integer(result.stats.positionsEvaluated)}</td><td>{integer(result.stats.cutoffs)}</td><td>{integer(result.stats.quiescenceNodes)}</td>
                <td>{result.status === "complete" ? <button className="lab-move" type="button" onClick={() => setHighlight(result.move)}>{moveName(result.move)}</button> : "—"}</td>
            </tr>)}</tbody></table></div>
        </> : <div className="lab-empty"><Icon name="rank" /><strong>Put the current engine to the test.</strong><p>Choose a position and run a benchmark. Results will appear here, one depth at a time.</p></div>}
        <p className="lab-footnote">Visited includes intermediate positions; evaluated counts static evaluations and game-over scores, including quiescence. Counts include repeated visits, not unique boards. Incomplete rows show partial counts. Check evasions can extend 8 plies past the capture limit. An unresolved check at that hard limit aborts the depth rather than accepting a static score. Loading and warmups are excluded from timings. Results reflect this browser and device.</p>
    </section>;
}
