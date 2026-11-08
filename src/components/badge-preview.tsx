'use client';

import Image from 'next/image';
import { useId, useRef } from 'react';
import { badgeById } from '@/lib/badges';

export default function BadgePreview({ id, collection = false }: { id: string; collection?: boolean }) {
  const previewId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const badge = badgeById.get(id);
  if (!badge) return null;

  function show() {
    const panel = preview.current, button = trigger.current;
    if (!panel || !button) return;
    panel.showPopover();
    const bounds = button.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
    const below = bounds.bottom + 8;
    panel.style.top = `${Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : bounds.top - height - 8, window.innerHeight - height - 8))}px`;
  }

  function hide() {
    preview.current?.hidePopover();
    pinned.current = false;
  }

  return <span className="badge-preview">
    <button ref={trigger} type="button" className="badge-preview-trigger" aria-label={`Enlarge ${badge.name} badge`} aria-haspopup="dialog" aria-controls={previewId}
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
      onPointerLeave={() => { if (!pinned.current) hide(); }}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }}
      onBlur={() => { if (!pinned.current) hide(); }}
      onClick={() => { if (pinned.current) hide(); else { show(); pinned.current = true; } }}>
      <Image className={collection ? 'badge-art' : undefined} src={badge.artwork} width={collection ? 108 : 34} height={collection ? 124 : 39} alt={badge.name} />
    </button>
    <span ref={preview} id={previewId} className="badge-preview-panel" popover="auto" role="dialog" aria-label={`${badge.name} badge`}
      onToggle={event => { if (event.newState === 'closed') pinned.current = false; }}>
      <button type="button" className="badge-preview-close" aria-label="Close badge preview" onClick={hide}>×</button>
      <Image src={badge.artwork} width={208} height={240} alt={badge.name} />
      <strong>{badge.name}</strong>
      <span>{badge.secret ? 'Description hidden' : badge.description}</span>
    </span>
  </span>;
}
