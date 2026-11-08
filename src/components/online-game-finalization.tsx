"use client";

import { useEffect, useState } from "react";
import { finalizeGame, type FinalizedGame } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { mergeAchievements } from '@/lib/badges';
import { BadgeUnlocks } from './badge-strip';

/** Mounted only for a finished online game with a server-issued ID. */
export default function OnlineGameFinalization({ gameId }: { gameId: string }) {
  const { user, setUser } = useAuth();
  const [result, setResult] = useState<FinalizedGame | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    finalizeGame(gameId).then(value => {
      if (active) {
        setResult(value);
        setUser(current => {
          const own = Object.values(value.achievements || {}).find(state => state.userId === current?._id);
          return mergeAchievements(current, own);
        });
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not save ratings.");
    });
    return () => { active = false; };
  }, [gameId, attempt, setUser]);

  if (error) return <div role="status"><p>{error}</p><button type="button" className="quiet-button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry saving ratings</button></div>;
  if (!result) return <p role="status">Saving ratings…</p>;
  const own = Object.values(result.ratings).find(rating => rating.userId === user?._id);
  if (!own) return <p role="status">Ratings saved.</p>;
  const change = (value: number) => value > 0 ? `+${value}` : String(value);
  const awards = Object.values(result.achievements || {}).find(state => state.userId === user?._id)?.badges;
  return <><p role="status">Your Elo: {own.after} ({change(own.change)}) · Saved</p><BadgeUnlocks awards={awards} /></>;
}
