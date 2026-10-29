import type { SVGProps } from "react";

const paths = {
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M18 6 6 18",
  bot: "M8 4h8v3H8zM5 8h14v12H5zM2 12h3m14 0h3M9 12v2m6-2v2m-6 3h6M12 1v3",
  flag: "M5 21V3m0 1h14l-3 4 3 4H5",
  rank: "m4 8 8-5 8 5-8 5-8-5zm0 5 8 5 8-5M4 18l8 5 8-5",
  chaos: "m13 2-8 12h7l-1 8 8-12h-7l1-8z",
  book: "M12 5v15M3 4h5l4 2 4-2h5v15h-5l-4 2-4-2H3z",
  trophy: "M7 3h10v6a5 5 0 0 1-10 0V3zM7 5H3v4l5 3m9-7h4v4l-5 3M12 14v6m-5 1h10",
  play: "m9 5 11 7-11 7V5z",
  shield: "m12 2 8 4v6c0 5-8 9-8 9s-8-4-8-9V6l8-4zM8 11l3 3 5-5",
  replay: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
  check: "m5 12 4 4L19 6",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 22v-3a8 8 0 0 1 16 0v3",
  chevron: "m7 10 5 5 5-5",
  logout: "M10 4H4v16h6m5-12 4 4-4 4m-6-4h10",
} as const;

export type IconName = keyof typeof paths;
export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
