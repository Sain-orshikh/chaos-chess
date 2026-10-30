import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Vercel injects configuration directly. Local scripts also understand env pull's .env.local.
if (!process.env.VERCEL) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    dotenv.config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });
}
