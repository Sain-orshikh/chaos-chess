import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/havoc", "/classic", "/local", "/encyclopedia", "/engine-lab", "/leaderboard"].map(path => ({ url: new URL(path, siteUrl).href }));
}
