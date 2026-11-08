"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import Icon from "./icon";
import NavIcon from "./nav-icon";
import { useAuth } from "./auth-provider";
import AccountDialog, { type AccountAction } from "./account-dialog";
import BadgeDialog from './badge-dialog';
import BadgeStrip from './badge-strip';

export default function Sidebar({ mobileOpen, collapsed, onClose }: { mobileOpen: boolean; collapsed: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, checking, signOut } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [action, setAction] = useState<AccountAction | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (authError) {
      startTransition(() => {
        setError(authError === "google_cancelled" ? "Google sign-in was cancelled." : "Google sign-in failed. Please try again.");
        setProfileOpen(true);
      });
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
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
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setProfileOpen(false); if (!action && !badgesOpen) onClose(); } }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [action, badgesOpen, onClose]);
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
          <span className="profile-copy"><strong>{checking ? "Loading profile…" : user?.displayName || user?.username || "Anonymous"}</strong><small>{user ? "Your profile" : "Playing as guest"}</small></span><Icon name="chevron" />
        </button>
        {profileOpen && <div className="profile-menu" id="profile-menu">
          {user ? <>
            <button onClick={() => { setProfileOpen(false); setBadgesOpen(true); }}>Your badges</button>
            <button onClick={() => openAccount("picture")}>Change profile picture</button>
            {user.hasPassword !== false && <button onClick={() => openAccount("password")}>Change password</button>}
            <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await signOut(); setProfileOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not sign out."); } finally { setBusy(false); } }}><Icon name="logout" />{busy ? "Signing out…" : "Sign out"}</button>
          </> : <><button onClick={() => openAccount("login")}>Sign in</button><button onClick={() => openAccount("signup")}>Create account</button><small>Anonymous games do not affect Elo.</small></>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>}
      </div>
      {user && <button type="button" className="profile-badges" onClick={() => setBadgesOpen(true)} aria-label="Choose profile badges">{user.equippedBadges?.length ? <BadgeStrip ids={user.equippedBadges} /> : <span>Choose your badges <span aria-hidden="true">＋</span></span>}</button>}
      <div className="profile-stats"><div><strong>{user?.elo?.toLocaleString() ?? "—"}</strong><span>Elo rating</span></div><div><strong>{user?.matches?.toLocaleString() ?? "—"}</strong><span>Matches</span></div><div><strong>{user?.wins?.toLocaleString() ?? "—"}</strong><span>Wins</span></div></div>
      <p className="nav-label">Play</p>
      <nav className="nav" aria-label="Game modes">
        <Link href="/chaos" className={(pathname === "/chaos" || pathname.startsWith("/chaos/")) ? "active" : ""} onClick={onClose}><NavIcon name="chaos" />Chaos</Link>
        <Link href="/classic" className={(pathname === "/classic" || pathname.startsWith("/classic/")) ? "active" : ""} onClick={onClose}><NavIcon name="classic" />Classic Chess</Link>
        <Link href="/" className={pathname === "/" ? "active" : ""} aria-current={pathname === "/" ? "page" : undefined} onClick={onClose}><NavIcon name="bot" />Play bot<span className="available" /></Link>
        <Link href="/local" className={pathname === "/local" ? "active" : ""} aria-current={pathname === "/local" ? "page" : undefined} onClick={onClose}><NavIcon name="local" />Local 1v1</Link>
      </nav>
      <p className="nav-label section-gap">Explore</p>
      <nav className="nav" aria-label="Explore">
        <Link href="/encyclopedia" className={pathname === "/encyclopedia" ? "active" : ""} aria-current={pathname === "/encyclopedia" ? "page" : undefined} onClick={onClose}><NavIcon name="book" />Encyclopedia</Link>
        <Link href="/engine-lab" className={pathname === "/engine-lab" ? "active" : ""} aria-current={pathname === "/engine-lab" ? "page" : undefined} onClick={onClose}><NavIcon name="lab" />Engine lab</Link>
        <Link href="/leaderboard" className={pathname === "/leaderboard" ? "active" : ""} aria-current={pathname === "/leaderboard" ? "page" : undefined} onClick={onClose}><NavIcon name="trophy" />Leaderboard</Link>
      </nav>
      <footer className="side-footer"><small><b>●</b> Early access<span>v.01</span></small><small>Chaos Chess © 2026</small></footer>
    </aside>
    {action && <AccountDialog action={action} onClose={() => { setAction(null); profileRef.current?.querySelector("button")?.focus(); }} />}
    {badgesOpen && <BadgeDialog onClose={() => { setBadgesOpen(false); profileRef.current?.querySelector('button')?.focus(); }} />}
  </>;
}
