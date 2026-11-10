import type { Metadata } from "next";

export const siteUrl = "https://havoc-chess.vercel.app";
export const portfolioUrl = "https://sain-orshikh.me";
export const siteDescription = "Play Havoc Chess, a chess variant by Sainorshikh with transforming rooks, rook-and-knight queens, and diagonal pawns. Challenge Rooke or play with friends.";

export function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Havoc Chess",
      title,
      description,
      url: path,
      images: [{ url: "/social-preview.png", width: 1200, height: 630, alt: "Havoc Chess — a familiar board, a different game. By Sainorshikh." }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/social-preview.png"] },
  };
}
