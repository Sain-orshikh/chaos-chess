"use client";

import { useEffect, useState } from "react";
import type { BasicMove, Board, Color, CastlingState, StandardState } from "./utils/types";

type MerlinMessage = { type: "result"; result: { move: BasicMove | null } } | { type: "error"; message: string };

type Props = {
    evaluationSeed?: number; board: Board; halfmoveClock: number; castling: CastlingState; standard?: StandardState; turn: Color; active: boolean;
    onMove: (move: BasicMove, board: Board, turn: Color) => void;
};

export default function MerlinPanel({ board, halfmoveClock, castling, standard, turn, active, onMove, evaluationSeed: savedSeed }: Props) {
    // Stable for every turn/depth in this game; a restart remounts this panel with a new seed.
    const [randomSeed] = useState(() => 1 + Math.floor(Math.random() * 0xffffffff));
    const evaluationSeed = savedSeed ?? randomSeed;
    const [failure, setFailure] = useState<{ board: Board; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const error = failure?.board === board ? failure.message : "";
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let worker: Worker | undefined;
        function fail(message: string) { if (!cancelled) setFailure({ board, message }); }
        try {
            worker = new Worker("/engines/merlin.worker.js", { type: "module" });
            const current = worker;
            current.onmessage = (event: MessageEvent<MerlinMessage>) => {
                if (cancelled) return;
                const message = event.data;
                if (message.type === "error") { fail(message.message); current.terminate(); }
                if (message.type === "result") {
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
    }, [active, board, halfmoveClock, castling, standard, turn, retry, onMove, evaluationSeed]);
    if (!error) return null;
    return <div className="bot-error" role="alert"><p>{error}</p><button type="button" className="quiet-button" onClick={() => { setFailure(null); setRetry(value => value + 1); }}>Retry bot move</button></div>;
}
