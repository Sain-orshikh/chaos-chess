import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = (process.env.API_BACKEND_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  // Use the compiler API supported by this project’s TypeScript 5 installation.
  experimental: { useTypeScriptCli: false },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
