import { pageMetadata } from "@/lib/site";
import Encyclopedia from "@/components/encyclopedia";

export const metadata = pageMetadata("Havoc piece rules", "Learn how every Havoc Chess piece moves, from transforming rooks to diagonal pawns, with animated examples.", "/encyclopedia");
export default function EncyclopediaPage() { return <Encyclopedia />; }
