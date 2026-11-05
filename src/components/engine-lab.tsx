"use client";

import { useEffect, useRef, useState, useReducer } from "react";
import Icon from "./icon";
import Board from "./board";
import { createGame, gameReducer, isGameOver } from "./common/game_state";
import type { GameAction, GameState } from "./common/game_state";
import { analysisReducer } from "./common/analysis_session";
import { formatFen } from "./utils/fen_parcer";
import { benchmarkPositions, parseBenchmarkFen } from "./common/benchmark_positions";
import type { BenchmarkMessage, BenchmarkRequest, BenchmarkResult } from "./common/benchmark";
import { DEFAULT_MAX_QUIESCENCE_PLY } from "./common/engine";
import { defaultBotSettings } from "./common/bot_search";
import type { BasicMove, Ruleset } from "./utils/types";

const integer = (value: number) => value.toLocaleString();
function time(value: number) { return value < 1000 ? `${value.toFixed(2)} ms` : `${(value / 1000).toFixed(2)} s`; }
function squareName(square: number) { return `${"abcdefgh"[square % 8]}${8 - Math.floor(square / 8)}`; }
function moveName(move: BasicMove | null) {
    if (!move) return "No legal move";
    if (move.kind === "rotate") return `${squareName(move.from)} · rotate`;
    if (move.kind === "castle") return `${squareName(move.from)} → ${squareName(move.to)} · castle`;
    return `${squareName(move.from)} → ${squareName(move.to)}${move.promotion ? ` = ${move.promotion}` : ""}`;
}
function gameFromFen(fen: string, ruleset: Ruleset = "chaos") {
    const parsed = parseBenchmarkFen(fen, ruleset);
    return createGame(parsed.board, parsed.turn, undefined, ruleset, parsed.standard, parsed.halfmoveClock);
}
const INITIAL_GAME = gameFromFen(benchmarkPositions[0].fen);

type Progress = Extract<BenchmarkMessage, { type: "progress" }>;

export default function EngineLab() {
    const [session, dispatchSession] = useReducer(analysisReducer, { game: INITIAL_GAME, history: [] });
    const game = session.game;
    const position = { board: game.board, turn: game.turn, fen: formatFen(game.board, game.turn, game.standard, game.halfmoveClock) };
    const rootGame = useRef<GameState>(INITIAL_GAME);
    const loadedFen = useRef<string>(benchmarkPositions[0].fen);
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

    function clearMeasurements() {
        setResults([]); setGeneration(null); setHighlight(null); setProgress(null);
        latest.current = null; setError(""); setStatus("Ready to benchmark");
    }
    function syncPosition(next: GameState) {
        if (!next.pendingPromotion) {
            const value = formatFen(next.board, next.turn, next.standard, next.halfmoveClock);
            setFen(value); loadedFen.current = value;
        }
        clearMeasurements();
    }
    function loadPosition(nextFen: string, nextPreset: string, ruleset = game.ruleset) {
        try {
            const next = gameFromFen(nextFen, ruleset);
            dispatchSession({ type: "load", game: next }); rootGame.current = next;
            syncPosition(next); setPreset(nextPreset);
        } catch (e) { setError(e instanceof Error ? e.message : "Invalid position."); }
    }
    function onGameAction(action: GameAction) {
        if (busy) return;
        const next = gameReducer(game, action);
        dispatchSession({ type: "game", action });
        if (next.board !== game.board) syncPosition(next);
    }
    function undo() {
        const next = analysisReducer(session, { type: "undo" });
        dispatchSession({ type: "undo" }); syncPosition(next.game);
    }
    function playSuggestion(move: BasicMove) {
        onGameAction({ type: "engine-move", move, expectedBoard: game.board, turn: game.turn });
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
        if (fen.trim() !== loadedFen.current) { setError("Load your edited FEN before starting the benchmark."); return; }
        const request: BenchmarkRequest = { fen: position.fen, castling: game.castling, standard: game.standard, ruleset: game.ruleset, modes: [defaultBotSettings.mode], maxDepth: depth, repetitions, timeLimitMs: limit, quiescence: true, maxQuiescencePly };
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
    const bestMove = results.filter(result => result.status === "complete").at(-1)?.move;
    return <section className="engine-lab">
        <div className="page-heading"><h1>Engine lab</h1><span className="lab-eyebrow">Measure. Compare. Improve.</span></div>
        <p className="lab-intro">Play either side, test the engine, then play its suggestion and continue from the new position.</p>
        <div className="lab-layout">
            <div className="lab-position">
                <div className="lab-board-header"><div><strong>{session.history.length ? `Analysis · ${session.history.length} ${session.history.length === 1 ? "ply" : "plies"}` : preset === "custom" ? "Custom position" : benchmarkPositions.find(item => item.id === preset)?.name}</strong><span>{position.turn === "white" ? "White" : "Black"} to move · {pieces} pieces</span></div><button className="quiet-button" type="button" onClick={() => setFlipped(value => !value)} aria-label="Flip board"><Icon name="replay" />Flip</button></div>
                <Board game={game} onAction={onGameAction} orientation={flipped ? "black" : "white"} analysis locked={busy} highlightedMove={highlight} />
                <div className="lab-play-actions">
                    <button type="button" className="primary-button" disabled={busy || !bestMove || !!game.pendingPromotion || isGameOver(game.status)} onClick={() => { if (bestMove) playSuggestion(bestMove); }}><Icon name="play" />Play best move</button>
                    <button type="button" className="quiet-button" disabled={busy || !session.history.length} onClick={undo}>Undo move</button>
                    <button type="button" className="quiet-button" disabled={busy || !session.history.length} onClick={() => { dispatchSession({ type: "load", game: rootGame.current }); syncPosition(rootGame.current); }}>Reset position</button>
                </div>
                <div className="lab-generation"><span>All legal moves · generation</span><strong>{generation ? `${generation.microseconds.toFixed(2)} µs` : "—"}</strong><small>{generation ? `${generation.legalMoves} legal moves · median of 3 warmed batches` : "Measured separately before the search"}</small></div>
            </div>
            <div className="lab-configuration">
                <fieldset disabled={busy}>
                    <legend className="sr-only">Benchmark configuration</legend>
                    <label className="lab-field">Rules<select value={game.ruleset} onChange={event => loadPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "start", event.target.value as Ruleset)}><option value="chaos">Chaos Chess</option><option value="normal">Classic Chess</option></select></label>
                    <label className="lab-field">Position<select value={preset} onChange={event => {
                        const item = benchmarkPositions.find(item => item.id === event.target.value);
                        if (item) loadPosition(item.fen, item.id);
                        else setPreset("custom");
                    }}>{benchmarkPositions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="custom">Custom FEN</option></select></label>
                    <form onSubmit={event => { event.preventDefault(); loadPosition(fen, "custom"); }}>
                        <label className="lab-field">FEN position<textarea rows={3} spellCheck={false} value={fen} onChange={event => setFen(event.target.value)} aria-describedby="fen-help" /></label>
                        <div className="lab-fen-footer"><small id="fen-help">{game.ruleset === "normal" ? "Normal rules. FEN includes castling rights and en passant." : "Chaos rules. D/d denotes a diagonal rook; standard castling and en passant fields are ignored."}</small><button className="quiet-button" type="submit">Load FEN</button></div>
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
                <div className="lab-actions">{busy ? <button type="button" className="primary-button" onClick={stop}><Icon name="close" />Stop benchmark</button> : <button type="button" className="primary-button" disabled={!!game.pendingPromotion || isGameOver(game.status)} onClick={run}><Icon name="play" />Run benchmark</button>}<span>Runs depths 1–{depth}. One ply is one player’s action.</span></div>
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
