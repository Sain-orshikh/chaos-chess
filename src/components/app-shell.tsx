"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";
import Icon from "./icon";
import { AuthProvider } from "./auth-provider";

const mobileQuery = "(max-width: 950px)";
function subscribeMobile(notify: () => void) {
  const query = matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const isMobile = useSyncExternalStore(subscribeMobile, () => matchMedia(mobileQuery).matches, () => false);
  const close = useCallback(() => { setMobileOpen(false); toggle.current?.focus(); }, []);
  return <AuthProvider><div className={`app-layout${mobileOpen ? " mobile-open" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar mobileOpen={mobileOpen} collapsed={collapsed} onClose={close} />
    <main className="app-main" inert={isMobile && mobileOpen}>
      <header className="topbar"><button ref={toggle} className="icon-button" aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded={isMobile ? mobileOpen : !collapsed} onClick={() => { if (matchMedia("(max-width: 950px)").matches) setMobileOpen(!mobileOpen); else setCollapsed(!collapsed); }}><Icon name="menu" /></button><div className="breadcrumb">Chaos Chess<span>/</span><strong>{pathname === "/encyclopedia" ? "Encyclopedia" : "Play bot"}</strong></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div></AuthProvider>;
}
