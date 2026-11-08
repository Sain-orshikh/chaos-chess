"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import Icon from "./icon";
import NavIcon from "./nav-icon";
import { readLeaderboard, retainedLeaderboard, type LeaderboardEntry, type LeaderboardSnapshot } from "@/lib/leaderboard";

const number = (value: number) => value.toLocaleString("en-US");
function Initial({ name }: { name: string }) { return <span className="leaderboard-avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "?"}</span>; }
function Player({ entry }: { entry: LeaderboardEntry }) {
    return <span className="leaderboard-player"><Initial name={entry.name} /><span className="leaderboard-name"><strong>{entry.name}</strong>{entry.name !== entry.username && <small>@{entry.username}</small>}<span className="leaderboard-mobile-stats">{number(entry.matches)} games · {number(entry.wins)} wins</span></span></span>;
}

export default function Leaderboard() {
    const { user, checking } = useAuth();
    const [snapshot, setSnapshot] = useState<LeaderboardSnapshot>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(true);
    const [page, setPage] = useState(0);
    const [time, setTime] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const tableHeading = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        let stopped = false;
        const retained = retainedLeaderboard();
        if (retained) queueMicrotask(() => { if (!stopped) setSnapshot(retained); });
        async function refresh() {
            try {
                const next = await readLeaderboard();
                if (!stopped) { setSnapshot(next); setError(""); setPage(current => Math.min(current, Math.max(0, Math.ceil(next.entries.length / 25) - 1))); }
            } catch (error) {
                if (!stopped) setError(error instanceof Error ? error.message : "Could not load the standings.");
            } finally { if (!stopped) { setBusy(false); setTime(Date.now()); } }
        }
        void refresh();
        const visible = () => { if (document.visibilityState === "visible") void refresh(); };
        document.addEventListener("visibilitychange", visible);
        // Only age labels update on this timer; it never requests ranking data.
        const timer = setInterval(() => setTime(Date.now()), 30_000);
        return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
    }, [attempt]);

    const entries = snapshot?.entries ?? [];
    const self = user && entries.find(entry => entry.userId === user._id);
    const remainingMatches = user ? Math.max(0, 5 - (user.matches ?? 0)) : 0;
    const cutoff = entries.length === 100 ? entries[99].elo : undefined;
    const gap = user && cutoff !== undefined ? cutoff - user.elo + 1 : 0;
    const minutes = snapshot ? Math.max(0, Math.floor((time - snapshot.generatedAt) / 60_000)) : 0;
    const expired = !!snapshot && time - snapshot.generatedAt > 86_400_000;
    const hasData = !!snapshot && !expired;
    const pages = Math.ceil(entries.length / 25);
    const shown = entries.slice(page * 25, page * 25 + 25);
    function turnPage(next: number) { setPage(next); tableHeading.current?.scrollIntoView({ behavior: "instant", block: "start" }); }

    return <section className="leaderboard-page" aria-labelledby="leaderboard-title">
        <div className="leaderboard-heading"><div><p className="eyebrow">The ranked arena</p><h1 id="leaderboard-title">Leaderboard</h1><p className="leaderboard-intro">A hundred players. Every move earned.</p></div><span className="leaderboard-tag">All-time · Combined Elo</span></div>

        {hasData && entries.length > 0 && <div className="leaderboard-contenders" aria-label="Leading players">{entries.slice(0, 3).map(entry => <article className="leaderboard-contender" key={entry.userId}>
            <div className="leaderboard-contender-rank"><span>#{entry.rank}</span><NavIcon name="trophy" /></div><Initial name={entry.name} /><div className="leaderboard-contender-name"><strong>{entry.name}</strong>{entry.name !== entry.username && <small>@{entry.username}</small>}</div><div className="leaderboard-contender-elo">{number(entry.elo)}<span>Elo</span></div><p>{number(entry.matches)} games · {number(entry.wins)} wins</p>
        </article>)}</div>}

        <div className="leaderboard-table-heading"><h2 ref={tableHeading}>Top 100 players</h2>{hasData && <span title={new Date(snapshot.generatedAt).toISOString()}>Updated {minutes < 1 ? "just now" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`}</span>}</div>
        {error && <div className="leaderboard-error" role="status"><p>{hasData ? "Couldn't refresh. Showing the last available standings." : error}</p><button className="quiet-button" disabled={busy} onClick={() => { setBusy(true); setAttempt(value => value + 1); }}>{busy ? "Retrying…" : "Retry"}</button></div>}
        {!snapshot && !error && <div className="leaderboard-loading" role="status" aria-label="Loading standings">{Array.from({ length: 5 }, (_, i) => <span key={i} />)}<p>Loading standings…</p></div>}
        {expired && !error && <p role="status" className="leaderboard-empty">Standings are out of date. Return to this page to check again.</p>}
        {hasData && entries.length === 0 && <div className="leaderboard-empty"><NavIcon name="trophy" /><h3>The arena is waiting.</h3><p>Players appear after completing 5 rated online matches.</p></div>}
        {hasData && entries.length > 0 && <div className="leaderboard-board"><table><caption className="leaderboard-sr-only">Players ranked by Elo, highest first. Equal Elo shares rank.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Elo</th><th scope="col" className="leaderboard-extra">Games</th><th scope="col" className="leaderboard-extra">Wins</th></tr></thead><tbody>{shown.map(entry => <tr key={entry.userId} className={entry.userId === user?._id ? "leaderboard-self" : undefined}>
            <td className={entry.rank <= 3 ? "leaderboard-top-rank" : undefined}>{entry.rank}</td><td><Player entry={entry} />{entry.userId === user?._id && <span className="leaderboard-you-label">You</span>}</td><td className="leaderboard-elo">{number(entry.elo)}</td><td className="leaderboard-extra">{number(entry.matches)}</td><td className="leaderboard-extra">{number(entry.wins)}</td>
        </tr>)}</tbody></table><div className="leaderboard-pagination"><span aria-live="polite">{page * 25 + 1}–{Math.min((page + 1) * 25, entries.length)} of {entries.length}</span><div><button className="quiet-button" disabled={page === 0} aria-label="Previous 25 players" onClick={() => turnPage(page - 1)}>Previous</button><span>{page + 1} / {pages}</span><button className="quiet-button" disabled={page + 1 >= pages} aria-label="Next 25 players" onClick={() => turnPage(page + 1)}>Next</button></div></div></div>}

        {hasData && !checking && <div className="leaderboard-standing"><Icon name="rank" /><div>{user ? <><strong>{remainingMatches > 0 ? `Complete ${remainingMatches} more rated match${remainingMatches === 1 ? "" : "es"} to qualify` : self ? `Your standing · #${self.rank}` : cutoff === undefined ? "Your place is on its way" : gap > 0 ? `You're ${number(gap)} Elo away from the top 100` : "Your Elo clears the latest cutoff"}</strong><p>{remainingMatches > 0 ? `${user.matches ?? 0} of 5 rated matches completed. Bot and local games don’t count.` : self ? "Your rating at the last standings update." : cutoff === undefined ? "Your account will appear in the next standings update." : "Based on the latest standings and your current Elo. The cutoff can move."}</p></> : <><strong>Your place starts here.</strong><p><Link href="/classic">Sign in and play online</Link> and complete 5 rated matches to qualify.</p></>}</div>{user && <span className="leaderboard-standing-elo">{number(self ? self.elo : user.elo)}<small>{self ? "Elo · at last update" : "Current Elo"}</small></span>}</div>}
        <p className="leaderboard-rules">Complete 5 rated online matches to qualify, then rank by Elo. Classic and Chaos share one rating. Wins don’t affect placement separately. Equal Elo shares rank; ties at the 100-player cutoff use account order.</p>
        <p className="leaderboard-refresh-note"><Icon name="replay" /><span>Standings refresh about every 5 minutes when viewed. Changes may take 6–7 minutes to appear. This page doesn’t update live; reopen it or return to the tab to check again.{hasData && minutes >= 7 && <strong> These standings may be out of date.</strong>}</span></p>
    </section>;
}
