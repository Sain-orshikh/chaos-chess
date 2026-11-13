import createKestrel from './kestrel.js';
import { searchPosition } from './kestrel-client.js';
const ready = createKestrel().then(engine => { engine._kestrel_init(); return engine; });
self.onmessage = async event => {
    try { const result = searchPosition(await ready, event.data); self.postMessage({ type: 'result', result }); }
    catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Kestrel search failed.' }); }
};
