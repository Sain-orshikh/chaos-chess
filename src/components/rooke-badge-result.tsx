"use client";

import { useEffect, useState } from 'react';
import { api, type User } from '@/lib/api';
import { useAuth } from './auth-provider';
import { BadgeUnlocks } from './badge-strip';

// Strict Mode/remounts share an in-flight claim. The server also makes duplicates
// harmless. Completed promises are released; ownership prevents future claims.
const pending = new Map<string, Promise<User>>();
export default function RookeBadgeResult() {
  const { user, setUser } = useAuth();
  const [error, setError] = useState('');
  const [awards, setAwards] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const id = user?._id, hasBadge = !!user?.badges?.['rooke-awakening'];
  useEffect(() => {
    if (!id || hasBadge) return;
    let request = pending.get(id);
    if (!request) {
      request = api<User>('/user/badges/rooke-win', {});
      pending.set(id, request);
      void request.finally(() => { if (pending.get(id) === request) pending.delete(id); }).catch(() => {});
    }
    let active = true;
    request.then(result => {
      setUser(current => current?._id === id ? { ...current, badges: { ...current.badges, ...result.badges } } : current);
      if (active) setAwards(Object.fromEntries(Object.entries(result.badges || {}).filter(([key]) => key === 'rooke-awakening' || key === 'three-musketiers')));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not save badge.'); });
    return () => { active = false; };
  }, [id, hasBadge, setUser, attempt]);
  if (!id) return <p className="result-unrated">Sign in to earn badges. This match is unrated.</p>;
  return <><p className="result-unrated">Unrated · No Elo or match count changes</p><BadgeUnlocks awards={awards} />{error && <div role="status"><p>{error}</p><button type="button" className="quiet-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry saving badge</button></div>}</>;
}
