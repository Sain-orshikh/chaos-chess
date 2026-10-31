"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./icon";
import { useAuth } from "./auth-provider";
import AccountDialog, { type AccountAction } from "./account-dialog";

export default function Sidebar({ mobileOpen, collapsed, onClose }: { mobileOpen: boolean; collapsed: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, checking, signOut } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [action, setAction] = useState<AccountAction | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 950px)");
    function sync() { if (aside.current) aside.current.inert = query.matches ? !mobileOpen : collapsed; }
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [mobileOpen, collapsed]);
  useEffect(() => {
    if (!mobileOpen) return;
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);
  useEffect(() => {
    function outside(event: PointerEvent) { if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setProfileOpen(false); if (!action) onClose(); } }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [action, onClose]);
  function openAccount(next: AccountAction) { setProfileOpen(false); setError(""); setAction(next); }

  return <>
    {mobileOpen && <button className="sidebar-shade" aria-label="Dismiss navigation" onClick={onClose} tabIndex={-1} />}
    <aside ref={aside} className="sidebar" id="sidebar" aria-label="Main navigation">
      <button ref={closeButton} className="icon-button sidebar-close" onClick={onClose} aria-label="Close sidebar"><Icon name="close" /></button>
      <Link className="brand" href="/" aria-label="Chaos Chess home" onClick={onClose}>
        <Image src="/brand-bishop.svg" width={36} height={60} alt="" className="brand-bishop" />
        <svg className="brand-lettering" viewBox="730 250 1010 500" aria-hidden="true"><defs><clipPath id="brand-lettering-crop"><path d="M775 250H1740V750H730V510H775Z" /></clipPath></defs><image href="/brand-lettering-source.png" width="1774" height="887" clipPath="url(#brand-lettering-crop)" /></svg>
      </Link>
      <div className="profile-container" ref={profileRef}>
        <button className="profile-toggle" aria-expanded={profileOpen} aria-controls="profile-menu" onClick={() => setProfileOpen(!profileOpen)}>
          <span className="avatar">{user?.profileImg ? <Image src={user.profileImg} alt="" width={43} height={43} unoptimized /> : <Icon name="person" />}</span>
          <span className="profile-copy"><strong>{checking ? "Loading profile…" : user?.username ?? "Anonymous"}</strong><small>{user ? "Your profile" : "Playing as guest"}</small></span><Icon name="chevron" />
        </button>
        {profileOpen && <div className="profile-menu" id="profile-menu">
          {user ? <>
            <button onClick={() => openAccount("picture")}>Change profile picture</button>
            <button onClick={() => openAccount("password")}>Change password</button>
            <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await signOut(); setProfileOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not sign out."); } finally { setBusy(false); } }}><Icon name="logout" />{busy ? "Signing out…" : "Sign out"}</button>
          </> : <><button onClick={() => openAccount("login")}>Sign in</button><button onClick={() => openAccount("signup")}>Create account</button><small>Anonymous games do not affect Elo.</small></>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>}
      </div>
      <div className="profile-stats"><div><strong>{user?.elo?.toLocaleString() ?? "—"}</strong><span>Elo rating</span></div><div><strong>{user?.matches?.toLocaleString() ?? "—"}</strong><span>Matches</span></div><div><strong>{user?.wins?.toLocaleString() ?? "—"}</strong><span>Wins</span></div></div>
      <p className="nav-label">Play</p>
      <nav className="nav" aria-label="Game modes">
        <button disabled><Icon name="flag" />Casual<span className="soon">Soon</span></button>
        <button disabled title="Ranked is not available"><Icon name="rank" />Ranked<span className="soon">Soon</span></button>
        <Link href="/" className={pathname === "/" ? "active" : ""} aria-current={pathname === "/" ? "page" : undefined} onClick={onClose}><Icon name="bot" />Play bot<span className="available" /></Link>
        <button disabled><Icon name="chaos" />Chaos mode<span className="soon">Soon</span></button>
      </nav>
      <p className="nav-label section-gap">Explore</p>
      <nav className="nav" aria-label="Explore">
        <Link href="/encyclopedia" className={pathname === "/encyclopedia" ? "active" : ""} aria-current={pathname === "/encyclopedia" ? "page" : undefined} onClick={onClose}><Icon name="book" />Encyclopedia</Link>
        <Link href="/engine-lab" className={pathname === "/engine-lab" ? "active" : ""} aria-current={pathname === "/engine-lab" ? "page" : undefined} onClick={onClose}><Icon name="rank" />Engine lab</Link>
        <button disabled><Icon name="trophy" />Leaderboard<span className="soon">Soon</span></button>
      </nav>
      <footer className="side-footer"><small><b>●</b> Early access<span>v.01</span></small><small>Chaos Chess © 2026</small></footer>
    </aside>
    {action && <AccountDialog action={action} onClose={() => { setAction(null); profileRef.current?.querySelector("button")?.focus(); }} />}
  </>;
}
