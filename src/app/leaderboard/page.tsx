import type { Metadata } from "next";
import Leaderboard from "@/components/leaderboard";

export const metadata: Metadata = { title: "Leaderboard · Chaos Chess", description: "The top 100 Chaos Chess players, ranked by Elo." };

export default function LeaderboardPage() { return <Leaderboard />; }
