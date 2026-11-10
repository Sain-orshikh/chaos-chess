import { pageMetadata } from "@/lib/site";
import MatchmakingLobby from "@/components/matchmaking-lobby";
export const metadata = pageMetadata("Play Havoc online", "Play Havoc Chess online with new piece movements, transforming rooks, and rated matches.", "/havoc");
export default function Page() { return <MatchmakingLobby ruleset="chaos" />; }
