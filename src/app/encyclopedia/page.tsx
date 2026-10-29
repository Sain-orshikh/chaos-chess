import type { Metadata } from "next";
import Encyclopedia from "@/components/encyclopedia";

export const metadata: Metadata = { title: "Encyclopedia · Chaos Chess" };
export default function EncyclopediaPage() { return <Encyclopedia />; }
