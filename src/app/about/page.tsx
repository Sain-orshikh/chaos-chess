import Link from "next/link";
import DeveloperNote from "@/components/developer-note";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata("Developer’s note — Sainorshikh", "Why Sainorshikh built Havoc Chess, the inspiration behind its new rules, and what’s next for Rooke, its TypeScript chess engine.", "/about");

export default function AboutPage() {
  return <article className="developer-note-page">
    <header><p className="note-eyebrow">Behind the board · Havoc Chess</p><h1>Developer’s note</h1></header>
    <DeveloperNote />
    <footer className="note-footer"><Link href="/">Challenge Rooke <span aria-hidden="true">→</span></Link><Link href="/encyclopedia">Learn the moves <span aria-hidden="true">→</span></Link></footer>
  </article>;
}
