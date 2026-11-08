import { Suspense } from "react";
import type { Metadata } from "next";
import OnlineMatch from "@/components/online-match";

export const metadata: Metadata = { title: "Chaos Chess match · Chaos Chess" };
async function Match({ params }: { params: Promise<{ gameId: string }> }) {
    const { gameId } = await params;
    return <OnlineMatch key={gameId} ruleset="chaos" gameId={gameId} />;
}
export default function Page({ params }: { params: Promise<{ gameId: string }> }) {
    return <Suspense fallback={<p role="status">Loading board…</p>}><Match params={params} /></Suspense>;
}
