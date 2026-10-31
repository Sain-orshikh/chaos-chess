import type { Metadata } from "next";
import EngineLab from "@/components/engine-lab";

export const metadata: Metadata = { title: "Engine lab · Chaos Chess" };
export default function EngineLabPage() { return <EngineLab />; }
