"use client";

import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";
import DeveloperNote from "./developer-note";
import Icon from "./icon";

export default function DeveloperNoteDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const modal = dialog.current;
    const focusTarget = returnFocus.current;
    modal?.showModal();
    return () => {
      modal?.close();
      focusTarget?.focus();
    };
  }, [returnFocus]);

  return <dialog ref={dialog} className="developer-note-dialog" aria-labelledby="developer-note-title" onCancel={onClose} onClick={event => {
    if (event.target instanceof Element && event.target.closest('a[href^="/"]')) {
      onClose();
      return;
    }
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <div className="dialog-heading"><div><p className="note-eyebrow">Behind the board</p><h2 id="developer-note-title">Developer’s note</h2></div><button type="button" autoFocus className="icon-button" aria-label="Close developer’s note" onClick={onClose}><Icon name="close" /></button></div>
    <DeveloperNote />
    <footer className="note-footer"><Link href="/about" onClick={onClose}>Open as a page <span aria-hidden="true">↗</span></Link><Link href="/encyclopedia" onClick={onClose}>Learn the moves <span aria-hidden="true">→</span></Link></footer>
  </dialog>;
}
