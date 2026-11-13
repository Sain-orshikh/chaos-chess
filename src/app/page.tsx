import { Suspense } from "react";
import PlayLobby from "@/components/play-lobby";
import { pageMetadata, portfolioUrl, siteDescription, siteUrl } from "@/lib/site";

export const metadata = { ...pageMetadata("Havoc Chess — Play Chess Online | By Sainorshikh", siteDescription, "/"), title: { absolute: "Havoc Chess — Play Chess Online | By Sainorshikh" } };

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Person", "@id": `${siteUrl}/#creator`, name: "Sainorshikh", url: portfolioUrl },
    { "@type": "WebSite", "@id": `${siteUrl}/#website`, name: "Havoc Chess", url: siteUrl, creator: { "@id": `${siteUrl}/#creator` } },
    { "@type": "VideoGame", "@id": `${siteUrl}/#game`, name: "Havoc Chess", url: siteUrl, description: siteDescription, genre: "Chess", gamePlatform: "Web browser", creator: { "@id": `${siteUrl}/#creator` } },
  ],
};

async function TestLobby({ searchParams }: { searchParams: Promise<{ test?: string | string[] }> }) {
  const { test } = await searchParams;
  const testMode = typeof test === "string" && test.toLowerCase() === "true";
  return <PlayLobby testMode={testMode} />;
}

export default function Home({ searchParams }: { searchParams: Promise<{ test?: string | string[] }> }) {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} /><Suspense fallback={<PlayLobby />}><TestLobby searchParams={searchParams} /></Suspense></>;
}
