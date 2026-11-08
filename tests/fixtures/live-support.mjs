// Isolated Mongo/pubsub adapters for tests; never used by the application.
export function memory() {
    const docs = new Map();
    return { docs, model: {
        findById(id) { return { async lean() { return structuredClone(docs.get(String(id)) || null); } }; },
        findOneAndUpdate(query, update) { return { async lean() { const old = docs.get(String(query._id)); if (!old || old.live.version !== query['live.version']) return null; const next = { ...old, ...structuredClone(update.$set) }; docs.set(String(query._id), next); return structuredClone(next); } }; },
        async create(document) { const doc = structuredClone({ ...document, _id: String(document._id) }); docs.set(doc._id, doc); return doc; },
        async updateOne(query, update) { if (!docs.has(String(query._id))) docs.set(String(query._id), structuredClone({ ...update.$setOnInsert, _id: String(query._id) })); },
    } };
}
export function infra() {
    const listeners = new Map(), scheduled = []; let commands = 0;
    return { scheduled, get commands() { return commands; }, async schedule(id, at) { commands++; scheduled.push({ id, at }); },
        async publish(id) { commands++; for (const cb of listeners.get(id) || []) cb(); },
        subscribe(id, cb) { commands++; const list = listeners.get(id) || new Set(); list.add(cb); listeners.set(id, list); return () => { commands++; list.delete(cb); }; },
    };
}
