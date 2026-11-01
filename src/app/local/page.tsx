import type { Metadata } from "next";
import PlayLobby from "@/components/play-lobby";

export const metadata: Metadata = { title: "Local 1v1 · Chaos Chess" };

export default function LocalPage() { return <PlayLobby local />; }
