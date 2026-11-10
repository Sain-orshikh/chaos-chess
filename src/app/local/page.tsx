import { pageMetadata } from "@/lib/site";
import PlayLobby from "@/components/play-lobby";

export const metadata = pageMetadata("Local 1v1", "Play Havoc or Classic Chess with a friend on one device. No account needed.", "/local");

export default function LocalPage() { return <PlayLobby local />; }
