import { Redis } from '@upstash/redis';
import { Client, Receiver } from '@upstash/qstash';
export function liveConfigured() {
    return ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'PUBLIC_API_URL'].every(key => !!process.env[key]);
}
export function createLiveInfra() {
    const redis = Redis.fromEnv();
    const qstash = new Client({ token: process.env.QSTASH_TOKEN });
    const endpoint = `${process.env.PUBLIC_API_URL.replace(/\/$/, '')}/api/live/deadline`;
    const receiver = new Receiver({ currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY });
    return {
        async schedule(id, time) {
            await qstash.publishJSON({ url: endpoint, body: { gameId: id }, notBefore: Math.ceil(time / 1000), retries: 5,
                deduplicationId: `${id}:${Math.ceil(time / 1000)}` });
        },
        async publish(id) { await redis.publish(`match:${id}`, { changed: true }); },
        subscribe(id, changed, failed) {
            const subscription = redis.subscribe(`match:${id}`);
            subscription.on('message', changed); subscription.on('error', failed);
            return () => subscription.unsubscribe();
        },
        async verify(signature, body) { return receiver.verify({ signature, body, url: endpoint }); },
    };
}
