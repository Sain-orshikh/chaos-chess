"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icon";
import Link from "next/link";

type Props = {
    finished: boolean;
    drawDisabled: boolean;
    onResign: () => void;
    onOfferDraw?: () => void;
    onRestart: () => void;
    onSetup?: () => void;
    onViewResult?: () => void;
};

export default function GameActions({ finished, drawDisabled, onResign, onOfferDraw, onRestart, onSetup, onViewResult }: Props) {
    const menu = useRef<HTMLDetailsElement>(null);
    const [confirm, setConfirm] = useState<"resign" | "restart" | "setup" | null>(null);
    useEffect(() => {
        function dismiss(event: PointerEvent) {
            if (!menu.current?.contains(event.target as Node)) { menu.current?.removeAttribute("open"); setConfirm(null); }
        }
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, []);
    function act(callback: () => void) { menu.current?.removeAttribute("open"); setConfirm(null); callback(); }
    return <details ref={menu} className="game-actions" onToggle={event => { if (!event.currentTarget.open) setConfirm(null); }} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); menu.current?.removeAttribute("open"); setConfirm(null); menu.current?.querySelector("summary")?.focus(); }
    }}>
        <summary className="quiet-button">Game actions<Icon name="chevron" /></summary>
        <div className="game-actions-menu">
            {confirm ? <div className="game-action-confirm"><p>{confirm === "resign" ? "Resign this game?" : confirm === "setup" ? "Leave this game and return to setup?" : "Restart this game?"}</p>
                <div><button type="button" onClick={() => act(confirm === "resign" ? onResign : confirm === "setup" ? onSetup! : onRestart)}>{confirm === "resign" ? "Confirm resignation" : confirm === "setup" ? "Leave game" : "Restart game"}</button><button type="button" onClick={() => setConfirm(null)}>Cancel</button></div>
            </div> : <>
                {!finished && <>{onOfferDraw && <button type="button" disabled={drawDisabled} onClick={() => act(onOfferDraw)}>Offer draw</button>}<button type="button" onClick={() => setConfirm("resign")}>Resign</button></>}
                {onViewResult && <button type="button" onClick={() => act(onViewResult)}>View result</button>}
                <button type="button" onClick={() => finished ? act(onRestart) : setConfirm("restart")}>{finished ? "New game" : "Restart"}</button>
                {onSetup && <button type="button" onClick={() => finished ? act(onSetup) : setConfirm("setup")}>Match setup</button>}
                <Link href="/encyclopedia">Piece rules</Link>
            </>}
        </div>
    </details>;
}
