"use client";

import { useEffect, useState } from "react";
import { chooseOpeningMove } from "./common/opening_book";
import BotStats, { type BotTelemetry, type NativeBotResult, nativeTelemetry } from "./bot-stats";
import type { BasicMove, Board, Color, CastlingState, StandardState } from "./utils/types";

type MerlinMessage = { type: "result"; result: NativeBotResult } | { type: "error"; message: string };

type Props = {
    testMode?: boolean; evaluationSeed?: number; plyCount?: number; board: Board; halfmoveClock: number; castling: CastlingState; standard?: StandardState; turn: Color; active: boolean;
    onMove: (move: BasicMove, board: Board, turn: Color) => void;
};

export default function MerlinPanel({ testMode = false, plyCount, board, halfmoveClock, castling, standard, turn, active, onMove, evaluationSeed: savedSeed }: Props) {
    // Stable for every turn/depth in this game; a restart remounts this panel with a new seed.
    const [randomSeed] = useState(() => 1 + Math.floor(Math.random() * 0xffffffff));
    const evaluationSeed = savedSeed ?? randomSeed;
    const [measurement, setMeasurement] = useState<{ board: Board; data: BotTelemetry } | null>(null);
    const [failure, setFailure] = useState<{ board: Board; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const error = failure?.board === board ? failure.message : "";
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let worker: Worker | undefined;
        function fail(message: string) { if (!cancelled) setFailure({ board, message }); }
        try {
            const bookMove = chooseOpeningMove({ board, turn, castling, standard, plyCount }, "merlin", evaluationSeed);
            if (bookMove) {
                queueMicrotask(() => {
                    if (cancelled) return;
                    if (testMode) setMeasurement({ board, data: { depth: 0, nodes: 0, quiescenceNodes: 0, outcome: "Opening book" } });
                    onMove(bookMove, board, turn);
                });
                return () => { cancelled = true; };
            }
            worker = new Worker("/engines/merlin.worker.js", { type: "module" });
            const current = worker;
            current.onmessage = (event: MessageEvent<MerlinMessage>) => {
                if (cancelled) return;
                const message = event.data;
                if (message.type === "error") { fail(message.message); current.terminate(); }
                if (message.type === "result") {
                    if (testMode) setMeasurement({ board, data: nativeTelemetry(message.result) });
                    current.terminate();
                    if (message.result.move) onMove(message.result.move, board, turn);
                    else fail("No move was returned. Restart the game or retry the search.");
                }
            };
            current.onerror = () => { fail("The bot could not finish its search. Try again."); current.terminate(); };
            current.postMessage({ board, halfmoveClock, castling, standard, turn, timeMs: 3000, evaluationSeed });
        } catch {
            queueMicrotask(() => fail("The background search could not start. Try again."));
        }
        return () => { cancelled = true; worker?.terminate(); };
    }, [active, board, plyCount, halfmoveClock, castling, standard, turn, retry, onMove, evaluationSeed, testMode]);
    return <>{testMode && <BotStats data={active && measurement?.board !== board ? null : measurement?.data ?? null} active={active} live={false} />}{error && <div className="bot-error" role="alert"><p>{error}</p><button type="button" className="quiet-button" onClick={() => { setFailure(null); setRetry(value => value + 1); }}>Retry bot move</button></div>}</>;
}
