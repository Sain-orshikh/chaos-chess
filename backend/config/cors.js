export function allowedOrigin(origin, host) {
    if (!origin) return true;
    const local = ["http://localhost:3000", "http://127.0.0.1:3000", process.env.FRONTEND_URL].filter(Boolean);
    if (local.includes(origin)) return true;
    if (!process.env.VERCEL || typeof host !== "string") return false;
    try {
        // Preview requests stay on their own deployment, not every *.vercel.app site.
        const url = new URL(origin);
        return url.protocol === "https:" && url.host === host && url.origin === origin;
    } catch { return false; }
}
