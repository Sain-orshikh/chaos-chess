"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Board from "./board";
import Icon from "./icon";
import { useAuth } from "./auth-provider";
import type { Color } from "./utils/types";

const opponents = [
  { name: "Local 1v1", piece: "king", detail: "Play both sides", available: true },
  { name: "Rooke", piece: "pawn", detail: "Easy", available: false },
  { name: "Vex", piece: "knight", detail: "Medium", available: false },
  { name: "Onyx", piece: "queen", detail: "Hard", available: false },
];

export default function PlayLobby() {
  const { user } = useAuth();
  const [side, setSide] = useState<Color | "random">("white");
  const [match, setMatch] = useState<{ orientation: Color } | null>(null);
  return <section>
    <div className="page-heading"><h1>{match ? "Local match" : "Match setup"}</h1><div className="page-actions">{match && <button className="quiet-button" onClick={() => { setMatch(null); window.scrollTo(0, 0); }}>Match setup</button>}<Link className="quiet-button" href="/encyclopedia"><Icon name="book" />Piece rules</Link></div></div>
    {match ? <div className="match-screen"><Board orientation={match.orientation} playerName={user?.username ?? "Anonymous"} /><p className="match-note">Unrated · No Elo or match count changes</p></div> : <div className="match-setup">
      <h2>Choose your opponent</h2>
      <div className="opponent-options">{opponents.map(opponent => <button key={opponent.name} className={`opponent-card${opponent.available ? " selected" : ""}`} disabled={!opponent.available} aria-pressed={opponent.available}>
        <Image src={`/pieces/white-${opponent.piece}.svg`} width={85} height={110} alt="" className="opponent-piece" />
        <span className="opponent-title">{opponent.name}</span><span className="opponent-detail">{opponent.detail}</span>{opponent.available ? <span className="selection-tick"><Icon name="check" /></span> : <span className="opponent-soon">Soon</span>}
      </button>)}</div>
      <h2>Choose your side</h2>
      <div className="color-options">{(["white", "random", "black"] as const).map(color => <button key={color} className={side === color ? "selected" : ""} aria-pressed={side === color} onClick={() => setSide(color)}><i className={`color-dot ${color}`} />{color[0].toUpperCase() + color.slice(1)}</button>)}</div>
      <div className="setup-bottom"><p><Icon name="shield" />{user ? "Unrated · No Elo or match count changes" : "Anonymous play · No Elo or match count changes"}</p><button className="primary-button" onClick={() => { setMatch({ orientation: side === "random" ? Math.random() < .5 ? "white" : "black" : side }); window.scrollTo(0, 0); }}>Start local match<Icon name="play" /></button></div>
    </div>}
  </section>;
}
