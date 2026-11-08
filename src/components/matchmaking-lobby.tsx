"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "./auth-provider";
import AccountDialog from "./account-dialog";
import NavIcon from "./nav-icon";
import type { Ruleset } from "./utils/types";

type Search = { state: "idle" } | { state: "queued"; ruleset: Ruleset; timeMs: number; joinedAt: number; range: number | null; serverNow: number } | { state: "matched"; ruleset: Ruleset; gameId: string };
type Counts = { online: number; queues: { ruleset: Ruleset; timeMs: number; count: number }[] };
const modeName = (ruleset: Ruleset) => ruleset === "chaos" ? "Chaos" : "Classic Chess";

export default function MatchmakingLobby({ ruleset }: { ruleset: Ruleset }) {
    const { user, checking } = useAuth();
    const router = useRouter();
    const connection = useRef("");
    const [timeMs, setTimeMs] = useState(300_000);
    const [search, setSearch] = useState<Search>({ state: "idle" });
    const [counts, setCounts] = useState<Counts | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [login, setLogin] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const userId = user?._id;
    const generation = useRef(0);
    const timerOrigin = useRef({ elapsed: 0, at: 0 });
    const accept = useCallback((next: Search) => {
        setSearch(next);
        if (next.state === "queued") {
            timerOrigin.current = { elapsed: Math.max(0, next.serverNow - next.joinedAt), at: performance.now() };
            setElapsed(Math.floor(timerOrigin.current.elapsed / 1000));
        }
        if (next.state === "matched") router.replace(`/${next.ruleset === "chaos" ? "chaos" : "classic"}/${next.gameId}`);
    }, [router]);
    useEffect(() => {
        connection.current ||= crypto.randomUUID();
        const connectionId = connection.current;
        const controller = new AbortController();
        let stopped = false, timeout: ReturnType<typeof setTimeout>;
        async function poll() {
            const version = generation.current;
            try {
                const nextCounts = await api<Counts>("/matchmaking/counts", undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
                if (!stopped) setCounts(nextCounts);
            } catch { if (!stopped) setCounts(null); }
            if (!userId && !stopped) setSearch({ state: "idle" });
            if (userId) {
                try {
                    const next = await api<Search>("/matchmaking/status", { connection: connectionId }, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
                    if (!stopped && version === generation.current) { accept(next); setError(""); }
                } catch (e) { if (!stopped && version === generation.current) setError(e instanceof Error ? e.message : "Could not restore your search."); }
            }
            if (!stopped) timeout = setTimeout(poll, 5000);
        }
        void poll();
        return () => { stopped = true; controller.abort(); clearTimeout(timeout); };
    }, [userId, accept, connection]);
    useEffect(() => {
        if (!userId) return;
        const connectionId = connection.current;
        const leave = () => { navigator.sendBeacon("/api/matchmaking/leave", new Blob([JSON.stringify({ connection: connectionId })], { type: "application/json" })); };
        const resume = (event: PageTransitionEvent) => { if (event.persisted) router.refresh(); };
        window.addEventListener("pagehide", leave);
        window.addEventListener("pageshow", resume);
        return () => { leave(); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", resume); };
    }, [userId, connection, router]);
    useEffect(() => {
        if (search.state !== "queued") return;
        const timer = setInterval(() => setElapsed(Math.floor((timerOrigin.current.elapsed + performance.now() - timerOrigin.current.at) / 1000)), 1000);
        return () => clearInterval(timer);
    }, [search.state]);
    async function command(action: "join" | "cancel") {
        if (busy) return;
        ++generation.current;
        setBusy(true); setError("");
        try { accept(await api<Search>(`/matchmaking/${action}`, action === "join" ? { ruleset, timeMs, connection: connection.current } : {})); }
        catch (e) { setError(e instanceof Error ? e.message : "Could not update your search."); }
        finally { ++generation.current; setBusy(false); }
    }
    const queued = search.state === "queued";
    const selectedTime = queued ? search.timeMs : timeMs;
    const selectedRules = queued ? search.ruleset : ruleset;
    const searchingCount = counts?.queues.find(queue => queue.ruleset === selectedRules && queue.timeMs === selectedTime)?.count ?? 0;
    const range = elapsed >= 60 ? null : Math.min(800, 100 + 100 * Math.floor(elapsed / 5));
    return <section className="matchmaking-page">
        <div className="matchmaking-heading"><NavIcon name={ruleset === "chaos" ? "chaos" : "classic"} /><div><p className="eyebrow">Play online</p><h1>{modeName(ruleset)}</h1></div></div>
        <p className="matchmaking-intro">Find your next opponent. Random colors. No increment.</p>
        <div className="matchmaking-counts"><span><b>{counts?.online ?? "—"}</b> online</span><span><b>{counts ? searchingCount : "—"}</b> searching · {modeName(selectedRules)} · {selectedTime / 60_000} min</span></div>
        <div className="matchmaking-card">
            <h2>{queued ? "Finding your opponent" : "Choose your clock"}</h2>
            <div className="matchmaking-times" role="group" aria-label="Time control">
                {[300_000, 600_000].map(time => <button key={time} aria-pressed={selectedTime === time} disabled={queued || busy} onClick={() => setTimeMs(time)}><strong>{time / 60_000}</strong><span>minutes</span></button>)}
            </div>
            {queued ? <div className="matchmaking-search" role="status"><p><span className="search-pulse" />Searching {modeName(search.ruleset)} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p><small>{range === null ? "Searching all ratings" : `Searching within ${range} points of your rating`}</small><p className="matchmaking-note">Your range expands as you wait. Keep this page open while searching.</p></div>
                : <p className="matchmaking-note">We start close to your rating, then widen the search quickly. Online games affect your Elo.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {queued ? <button className="matchmaking-primary" disabled={busy} onClick={() => void command("cancel")}>{busy ? "Updating…" : "Cancel search"}</button>
                : <button className="matchmaking-primary" disabled={busy || checking || search.state === "matched"} onClick={() => user ? void command("join") : setLogin(true)}>{checking ? "Loading account…" : busy ? "Joining…" : search.state === "matched" ? "Opening match…" : user ? "Find opponent" : "Sign in to play"}</button>}
            {!user && <p className="matchmaking-note">An account is required for online play. Bot and local games are open to everyone.</p>}
        </div>
        <p className="matchmaking-footnote">Online counts are approximate and count each active account once.</p>
        {login && <AccountDialog action="login" onClose={() => setLogin(false)} />}
    </section>;
}
