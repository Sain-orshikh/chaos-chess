import { pageMetadata } from "@/lib/site";
import MatchmakingLobby from "@/components/matchmaking-lobby";
export const metadata = pageMetadata("Play Classic Chess online", "Play Classic Chess online on Havoc Chess. Find an opponent and compete in rated matches.", "/classic");
export default function Page() { return <MatchmakingLobby ruleset="normal" />; }
