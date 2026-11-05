"use client";

import Link from "next/link";
import { useState } from "react";
import Board from "./board";
import Icon from "./icon";
import { useAuth } from "./auth-provider";
import type { Color, Ruleset } from "./utils/types";

export default function PlayLobby({ local = false }: { local?: boolean }) {
  const { user } = useAuth();
  const [ruleset, setRuleset] = useState<Ruleset>("chaos");
  const [side, setSide] = useState<Color | "random">("white");
  const [match, setMatch] = useState<{ orientation: Color; ruleset: Ruleset } | null>(null);
  return <section>
    <div className="page-heading"><h1>{local ? "Local 1v1" : "Play Rooke"}</h1><div className="page-actions">{match && <button className="quiet-button" onClick={() => { setMatch(null); window.scrollTo(0, 0); }}>Match setup</button>}<Link className="quiet-button" href="/encyclopedia"><Icon name="book" />Piece rules</Link></div></div>
    {match ? <div className={`match-screen${local ? "" : " bot-match-screen"}`}><Board key={match.ruleset} ruleset={match.ruleset} orientation={match.orientation} playerName={user?.username ?? "Anonymous"} bot={!local} /><p className="match-note">{match.ruleset === "chaos" ? "Chaos Chess" : "Normal Chess"} · Unrated · No Elo or match count changes</p></div> : <div className="match-setup">
      <div className="match-opponent"><Icon name={local ? "person" : "bot"} /><div><h2>{local ? "Two players, one board" : "Rooke"}</h2><p>{local ? "Take turns on this device." : "Play against our current engine."}</p></div></div>
      <h2>Choose your rules</h2>
      <div className="color-options">{(["chaos", "normal"] as const).map(value => <button key={value} className={ruleset === value ? "selected" : ""} aria-pressed={ruleset === value} onClick={() => setRuleset(value)}>{value === "chaos" ? "Chaos Chess" : "Normal Chess"}</button>)}</div>
      <p>{ruleset === "chaos" ? "Our variant pieces and once-per-side castling." : "Standard piece movement, castling rights, and en passant."}</p>
      <h2>{local ? "Choose the board orientation" : "Choose your side"}</h2>
      <div className="color-options">{(["white", "random", "black"] as const).map(color => <button key={color} className={side === color ? "selected" : ""} aria-pressed={side === color} onClick={() => setSide(color)}><i className={`color-dot ${color}`} />{color[0].toUpperCase() + color.slice(1)}</button>)}</div>
      <div className="setup-bottom"><p><Icon name="shield" />{user ? "Unrated · No Elo or match count changes" : "Anonymous play · No Elo or match count changes"}</p><button className="primary-button" onClick={() => { setMatch({ ruleset, orientation: side === "random" ? Math.random() < .5 ? "white" : "black" : side }); window.scrollTo(0, 0); }}>{local ? "Start local match" : "Play Rooke"}<Icon name="play" /></button></div>
    </div>}
  </section>;
}
