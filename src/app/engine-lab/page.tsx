import { pageMetadata } from "@/lib/site";
import EngineLab from "@/components/engine-lab";

export const metadata = pageMetadata("Engine lab", "Explore the Havoc Chess engine: compare search methods, load positions, and inspect Rooke’s decisions.", "/engine-lab");
export default function EngineLabPage() { return <EngineLab />; }
