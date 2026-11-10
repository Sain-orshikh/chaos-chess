import { pageMetadata } from "@/lib/site";
import Leaderboard from "@/components/leaderboard";

export const metadata = pageMetadata("Leaderboard", "Climb the Havoc Chess leaderboard, compete in rated online matches, and earn badges.", "/leaderboard");

export default function LeaderboardPage() { return <Leaderboard />; }
