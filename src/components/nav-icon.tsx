import Image from "next/image";
import { useId } from "react";

export type NavIconName = "chaos" | "classic" | "bot" | "local" | "book" | "lab" | "trophy";

// Broad silhouettes, diagonal breaks and open counters echo the two brand pieces.
const silhouettes = {
  classic: "M14 1h4v4h4v4h-4v4h-4V9h-4V5h4ZM5 15h22l-4 8-16 7-1-7Zm19 11 2 9h3v4H3v-4h3l1-2Zm-8 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  local: "M9 3a5 5 0 1 1 0 10A5 5 0 0 1 9 3Zm-4 13h8l2 12-12 5Zm11 14 1 5h2v4H0v-4h2l1-1ZM29 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-4 13h8l2 10-12 5Zm11 12 1 3h3v4H21v-4h2Z",
  book: "M1 5h3l10 4v26L4 31H1Zm17 4 10-4h3v26h-3l-10 4ZM5 12v2l6 2v-2Zm0 6v2l6 2v-2Zm17-4v2l5-2v-2Zm0 6v2l5-2v-2ZM1 34h3l10 4h4l10-4h3v5h-3l-10 1h-4L4 39H1Z",
  lab: "M9 1h14v4h-3v11l7 10-24 10 9-20V5H9Zm6 5v11l-4 8h10l-5-8V6Zm14 23 2 5c2 3 0 6-3 6H4c-2 0-3-1-3-2Zm-8 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  trophy: "M7 2h18v13c0 5-3 8-7 10v6h6v4H8v-4h6v-6c-4-2-7-5-7-10ZM0 6h5v4H4v5l4 3v5l-8-6Zm27 0h5v11l-8 6v-5l4-3v-5h-1ZM5 37h22v3H5ZM14 7v7h4V7Z",
} as const;

// Follow each silhouette's diagonal break, leaving its lower section silver.
const accentClips = {
  classic: ["0,0 32,0 32,19 0,33"],
  local: ["0,0 20,0 20,26 0,35", "20,0 40,0 40,28 20,37"],
  book: ["0,0 32,0 32,17 0,31"],
  lab: ["0,0 32,0 32,24 0,38"],
  trophy: ["0,0 32,0 32,17 0,31"],
} as const;

export default function NavIcon({ name }: { name: NavIconName }) {
  const accentId = useId();
  if (name === "chaos" || name === "bot") {
    return <Image src={name === "chaos" ? "/brand-bishop.svg" : "/brand-rooke.svg"} width={20} height={24} alt="" className="nav-symbol nav-brand-symbol" />;
  }
  return <svg className="nav-symbol" viewBox={name === "local" ? "0 0 40 40" : "0 0 32 40"} fill="currentColor" fillRule="evenodd" aria-hidden="true"><defs><clipPath id={accentId}>{accentClips[name].map(points => <polygon key={points} points={points} />)}</clipPath></defs><path d={silhouettes[name]} /><path className="nav-symbol-accent" d={silhouettes[name]} clipPath={`url(#${accentId})`} /></svg>;
}
