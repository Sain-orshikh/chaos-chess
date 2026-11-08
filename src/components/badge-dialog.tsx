"use client";

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { api, type User } from '@/lib/api';
import { badges, badgeProgressLabel } from '@/lib/badges';
import { useAuth } from './auth-provider';
import BadgeStrip from './badge-strip';
import Icon from './icon';

export default function BadgeDialog({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(user?.equippedBadges || []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const userId = user?._id;
  useEffect(() => { const modal = dialog.current; modal?.showModal(); return () => modal?.close(); }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    api<User>('/user/badges/sync', {}).then(result => {
      if (!active) return;
      setUser(current => current?._id === result._id ? result : current);
      setSelected(result.equippedBadges || []);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load badges.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, setUser, attempt]);
  async function save() {
    setSaving(true); setError('');
    try {
      const result = await api<User>('/user/badges/equip', { equippedBadges: selected });
      setUser(current => current?._id === result._id ? result : current); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save badges.'); }
    finally { setSaving(false); }
  }
  if (!user) return null;
  const earned = badges.filter(badge => user.badges?.[badge.id]).length;
  return <dialog ref={dialog} className="badge-dialog" aria-labelledby="badge-dialog-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="dialog-heading"><div><p className="badge-eyebrow">Your collection · {earned} / {badges.length}</p><h2 id="badge-dialog-title">Earned stories</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close badges"><Icon name="close" /></button></div>
    <p className="dialog-note">Choose up to three badges to display on your profile and in multiplayer. Match badges are set when the match starts.</p>
    {loading && <p role="status">Loading your collection…</p>}
    {error && <div role="alert" className="form-error">{error} <button type="button" className="text-button" disabled={loading || saving} onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Refresh collection</button></div>}
    <div className="badge-collection">{badges.map(badge => {
      const date = user.badges?.[badge.id]; const owned = !!date; const equipped = selected.includes(badge.id);
      const progress = owned ? null : badgeProgressLabel(badge.id, user);
      return <article className={`badge-card${owned ? ' earned' : ' locked'}`} key={badge.id}>
        <Image className="badge-art" src={badge.artwork} alt="" width={108} height={124} />
        <h3>{badge.name}</h3><p>{badge.secret ? 'Description hidden' : badge.description}</p>
        <small>{owned ? `Earned ${new Date(date).toLocaleDateString()}` : progress || (badge.category === 'Leaderboard' && (user.matches || 0) < 5 ? `${user.matches || 0} / 5 rated matches to qualify` : 'Locked')}</small>
        <button type="button" className={`badge-equip${equipped ? ' equipped' : ''}`} aria-pressed={equipped} aria-label={`${equipped ? 'Unequip' : 'Equip'} ${badge.name}`} disabled={!owned || loading || saving || (!equipped && selected.length >= 3)} onClick={() => setSelected(current => current.includes(badge.id) ? current.filter(id => id !== badge.id) : [...current, badge.id])}>{equipped ? '✓ Equipped' : owned ? '+ Equip' : 'Locked'}</button>
      </article>;
    })}</div>
    <div className="badge-dialog-footer"><div><BadgeStrip ids={selected} /><p>{selected.length} of 3 slots selected</p></div><button type="button" className="primary-button" disabled={loading || saving} onClick={save}>{saving ? 'Saving…' : 'Save badges'}</button></div>
  </dialog>;
}
