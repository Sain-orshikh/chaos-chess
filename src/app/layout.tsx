import { Suspense } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import AppShell from "@/components/app-shell";
import { portfolioUrl, siteDescription, siteUrl } from "@/lib/site";
import "./globals.css";

const barlow = localFont({ variable: "--font-interface", display: "swap", src: [
  { path: "../../public/fonts/barlow-400.woff2", weight: "400" },
  { path: "../../public/fonts/barlow-500.woff2", weight: "500" },
  { path: "../../public/fonts/barlow-600.woff2", weight: "600" },
  { path: "../../public/fonts/barlow-700.woff2", weight: "700" },
] });
const barlowCondensed = localFont({ variable: "--font-display", display: "swap", src: [
  { path: "../../public/fonts/barlow-condensed-500.woff2", weight: "500" },
  { path: "../../public/fonts/barlow-condensed-600.woff2", weight: "600" },
  { path: "../../public/fonts/barlow-condensed-700.woff2", weight: "700" },
] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Havoc Chess — Play Chess Online | By Sainorshikh", template: "%s | Havoc Chess" },
  description: siteDescription,
  applicationName: "Havoc Chess",
  authors: [{ name: "Sainorshikh", url: portfolioUrl }],
  creator: "Sainorshikh",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}><body><Suspense fallback={<main className="page-content"><p role="status">Loading game…</p></main>}><AppShell>{children}</AppShell></Suspense><Analytics /></body></html>;
}
