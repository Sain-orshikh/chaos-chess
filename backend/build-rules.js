import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const output = fileURLToPath(new URL('./generated/chess.js', import.meta.url));
if (existsSync(new URL('../src/components/common/game_state.ts', import.meta.url))) {
    await build({ entryPoints: [fileURLToPath(new URL('./live/chess-entry.ts', import.meta.url))], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node24' });
} else if (!existsSync(output)) {
    throw new Error('Shared chess rules are missing. Run the root build before packaging the backend.');
}
