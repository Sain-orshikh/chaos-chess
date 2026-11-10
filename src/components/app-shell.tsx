"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
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
  const noteToggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const isMobile = useSyncExternalStore(subscribeMobile, () => matchMedia(mobileQuery).matches, () => false);
  const close = useCallback(() => { setMobileOpen(false); toggle.current?.focus(); }, []);
  const openNote = useCallback(() => { setMobileOpen(false); setNoteOpen(true); }, []);
  return <AuthProvider><div className={`app-layout${mobileOpen ? " mobile-open" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar mobileOpen={mobileOpen} collapsed={collapsed} onClose={close} onDeveloperNote={openNote} />
    <main className="app-main" inert={isMobile && mobileOpen}>
      <header className="topbar"><button ref={toggle} className="icon-button" aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded={isMobile ? mobileOpen : !collapsed} onClick={() => { if (matchMedia("(max-width: 950px)").matches) setMobileOpen(!mobileOpen); else setCollapsed(!collapsed); }}><Icon name="menu" /></button><div className="breadcrumb">Havoc Chess<span>/</span><strong>{pathname === "/havoc" ? "Play Havoc" : pathname === "/classic" ? "Play Classic" : pathname.startsWith("/havoc/") ? "Havoc match" : pathname.startsWith("/classic/") ? "Classic match" : pathname === "/leaderboard" ? "Leaderboard" : pathname === "/engine-lab" ? "Engine lab" : pathname === "/encyclopedia" ? "Encyclopedia" : pathname === "/local" ? "Local 1v1" : pathname === "/about" ? "Developer’s note" : "Play bot"}</strong></div><button ref={noteToggle} className="note-trigger" type="button" aria-label="Developer’s note" aria-haspopup="dialog" onClick={openNote}><Icon name="book" /><span>Developer’s note</span></button></header>
      <div className="page-content">{children}</div>
    </main>
  </div>{noteOpen && <DeveloperNoteDialog returnFocus={noteToggle} onClose={() => setNoteOpen(false)} />}</AuthProvider>;
}
