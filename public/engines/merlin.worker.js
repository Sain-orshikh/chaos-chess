import createMerlin from './merlin.js';
import { searchPosition } from './merlin-client.js';
const ready = createMerlin().then(engine => { engine._merlin_init(); return engine; });
self.onmessage = async event => {
    try { const result = searchPosition(await ready, event.data); self.postMessage({ type: 'result', result }); }
    catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Merlin search failed.' }); }
};
