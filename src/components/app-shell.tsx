"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { portfolioUrl } from "@/lib/site";
import Sidebar from "./sidebar";
import Icon from "./icon";
import { AuthProvider } from "./auth-provider";
import DeveloperNoteDialog from "./developer-note-dialog";

const mobileQuery = "(max-width: 950px)";
function subscribeMobile(notify: () => void) {
  const query = matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const isOnlineMatch = pathname.startsWith("/havoc/") || pathname.startsWith("/classic/");
  const isMobile = useSyncExternalStore(subscribeMobile, () => matchMedia(mobileQuery).matches, () => false);
  const close = useCallback(() => { setMobileOpen(false); toggle.current?.focus(); }, []);
  const openNote = useCallback(() => { setMobileOpen(false); setNoteOpen(true); }, []);
  return <AuthProvider><div className={`app-layout${mobileOpen ? " mobile-open" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar mobileOpen={mobileOpen} collapsed={collapsed} onClose={close} onDeveloperNote={openNote} />
    <main className="app-main" inert={isMobile && mobileOpen}>
      <header className="topbar"><button ref={toggle} className="icon-button" aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded={isMobile ? mobileOpen : !collapsed} onClick={() => { if (matchMedia("(max-width: 950px)").matches) setMobileOpen(!mobileOpen); else setCollapsed(!collapsed); }}><Icon name="menu" /></button><div className="breadcrumb">Havoc Chess<span>/</span><strong>{pathname === "/havoc" ? "Play Havoc" : pathname === "/classic" ? "Play Classic" : pathname.startsWith("/havoc/") ? "Havoc match" : pathname.startsWith("/classic/") ? "Classic match" : pathname === "/leaderboard" ? "Leaderboard" : pathname === "/encyclopedia" ? "Encyclopedia" : pathname === "/local" ? "Local 1v1" : pathname === "/about" ? "Developer’s note" : "Play bot"}</strong></div></header>
      <div className="page-content">{children}</div>
      {!isOnlineMatch && <footer className="page-content site-footer"><p>Havoc Chess is a chess variant by <a href={portfolioUrl} rel="author">Sainorshikh</a>. New moves, a fresh challenge. <Link href="/about">The story behind the game <span aria-hidden="true">↗</span></Link></p></footer>}
    </main>
  </div>{noteOpen && <DeveloperNoteDialog returnFocus={toggle} onClose={() => setNoteOpen(false)} />}</AuthProvider>;
}
