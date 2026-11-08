"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createGame, gameReducer, isGameOver } from "./common/game_state";
import type { GameAction } from "./common/game_state";
import { decodeMatch, encodeMatch, MATCH_SAVE_MS, matchStorageKey } from "./common/saved_match";
import type { SavedMatch } from "./common/saved_match";
import { parseFen } from "./utils/fen_parcer";
import Board from "./board";
import Icon from "./icon";
import NavIcon from "./nav-icon";
import { useAuth } from "./auth-provider";
import type { Color, Ruleset } from "./utils/types";

export default function PlayLobby({ local = false }: { local?: boolean }) {
  const { user } = useAuth();
  const [ruleset, setRuleset] = useState<Ruleset>("chaos");
  const [side, setSide] = useState<Color | "random">("white");
  const [match, setMatch] = useState<SavedMatch | null>(null);
  const [saved, setSaved] = useState<SavedMatch | null>(null);
  const [saveError, setSaveError] = useState("");
  const matchRef = useRef<SavedMatch | null>(null);
  const readSaved = useCallback(() => {
    try {
      const key = matchStorageKey(local);
      const restored = decodeMatch(localStorage.getItem(key));
      if (!restored) localStorage.removeItem(key);
      return restored;
    } catch { return null; }
  }, [local]);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) setSaved(readSaved()); }); return () => { cancelled = true; }; }, [readSaved]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), Math.max(0, saved.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [saved]);
  const store = useCallback((next: SavedMatch) => {
    try {
      if (isGameOver(next.game.status)) localStorage.removeItem(matchStorageKey(local));
      else localStorage.setItem(matchStorageKey(local), encodeMatch(next));
      setSaveError("");
    } catch { setSaveError("This browser could not save the match. Keep this page open to continue playing."); }
  }, [local]);
  const onAction = useCallback((action: GameAction) => {
    const current = matchRef.current;
    if (!current) return;
    const game = gameReducer(current.game, action);
    if (game === current.game) return;
    const changed = game.board !== current.game.board || game.status !== current.game.status || game.drawOffer !== current.game.drawOffer;
    const next = { ...current, game, expiresAt: game.board !== current.game.board ? Date.now() + MATCH_SAVE_MS : current.expiresAt, evaluationSeed: action.type === "restart" ? 1 + Math.floor(Math.random() * 0xffffffff) : current.evaluationSeed };
    matchRef.current = next;
    setMatch(next);
    if (changed) store(next);
  }, [store]);
  function startMatch() {
    const next: SavedMatch = { orientation: side === "random" ? Math.random() < .5 ? "white" : "black" : side,
      game: createGame(parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), "white", undefined, ruleset),
      evaluationSeed: 1 + Math.floor(Math.random() * 0xffffffff), expiresAt: Date.now() + MATCH_SAVE_MS };
    matchRef.current = next; setMatch(next); setSaved(null); store(next); window.scrollTo(0, 0);
  }
  function resumeMatch() {
    const next = readSaved();
    setSaved(next);
    if (next) { matchRef.current = next; setMatch(next); window.scrollTo(0, 0); }
  }
  function setup() { matchRef.current = null; setMatch(null); setSaved(readSaved()); window.scrollTo(0, 0); }
  return <section>
    <div className="page-heading"><h1>{local ? "Local 1v1" : "Play Rooke"}</h1><div className="page-actions">{!match && <Link className="quiet-button" href="/encyclopedia"><Icon name="book" />Piece rules</Link>}</div></div>
    {match ? <div className={`match-screen${local ? "" : " bot-match-screen"}`}><Board ruleset={match.game.ruleset} game={match.game} onAction={onAction} evaluationSeed={match.evaluationSeed} orientation={match.orientation} playerName={user?.displayName || user?.username || "Anonymous"} playerImage={user?.profileImg} bot={!local} onSetup={setup} /><p className="match-note">{match.game.ruleset === "chaos" ? "Chaos Chess" : "Classic Chess"} · Unrated · No Elo or match count changes</p></div> : <div className="match-setup">
      <div className="match-opponent">{local ? <NavIcon name="local" /> : <Image src="/brand-rooke.svg" width={44} height={60} alt="" className="rooke-logo" />}<div><h2>{local ? "Two players, one board" : <>Rooke <span className="bot-rating" title="Provisional Classic chess rating">(1650)</span></>}</h2><p>{local ? "Take turns on this device." : "Play against our current engine."}</p></div></div>
      {saved && <div className="resume-match"><div><strong>Continue your {local ? "local" : "bot"} match</strong><p>{saved.game.ruleset === "chaos" ? "Chaos Chess" : "Classic Chess"} · Saved for 3 hours after your last move</p></div><button className="quiet-button" onClick={resumeMatch}>Resume match<Icon name="play" /></button></div>}
      <h2>Choose your rules</h2>
      <div className="color-options">{(["chaos", "normal"] as const).map(value => <button key={value} className={ruleset === value ? "selected" : ""} aria-pressed={ruleset === value} onClick={() => setRuleset(value)}>{value === "chaos" ? "Chaos Chess" : "Classic Chess"}</button>)}</div>
      <p>{ruleset === "chaos" ? "Our variant pieces and once-per-side castling." : "Standard piece movement, castling rights, and en passant."}</p>
      <h2>{local ? "Choose the board orientation" : "Choose your side"}</h2>
      <div className="color-options">{(["white", "random", "black"] as const).map(color => <button key={color} className={side === color ? "selected" : ""} aria-pressed={side === color} onClick={() => setSide(color)}><i className={`color-dot ${color}`} />{color[0].toUpperCase() + color.slice(1)}</button>)}</div>
      <div className="setup-bottom"><p><Icon name="shield" />{user ? "Unrated · No Elo or match count changes" : "Anonymous play · No Elo or match count changes"}</p><button className="primary-button" onClick={startMatch}>{saved ? "Start new match" : local ? "Start local match" : "Play Rooke"}<Icon name="play" /></button></div>
    </div>}
    {saveError && <p className="form-error" role="status">{saveError}</p>}
  </section>;
}
