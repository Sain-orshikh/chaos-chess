import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the component's real socket effect with a deterministic browser clock.
const source = ts.transpileModule(readFileSync(new URL('../src/components/live-match.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function browser() {
    const effects = [], sockets = [], notices = [];
    class Socket {
        static OPEN = 1; static CLOSING = 2;
        readyState = 0; sent = [];
        constructor() { sockets.push(this); }
        open() { this.readyState = 1; this.onopen(); }
        send(data) { this.sent.push(JSON.parse(data)); }
        close(code = 1000) { this.readyState = 3; this.onclose({ code }); }
        snapshot(data) { this.onmessage({ data: JSON.stringify({ type: 'snapshot', data }) }); }
    }
    const hooks = {
        useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useCallback: fn => fn,
        useState: value => [value, next => notices.push(next)],
    };
    const context = {
        exports: {}, setTimeout, clearTimeout, setInterval, clearInterval, URL,
        performance: { now: () => Date.now() }, WebSocket: Socket,
        window: { location: { href: 'https://chess.example/classic/test' } },
        require: name => name === 'react' ? hooks : name === 'next/navigation' ? { useRouter: () => ({ replace() {} }) }
            : name === './auth-provider' ? { useAuth: () => ({ user: null, setUser() {} }) }
            : name === 'react/jsx-runtime' ? { jsx() {}, jsxs() {} } : { default() {} },
    };
    vm.runInNewContext(source, context);
    context.exports.default({ gameId: 'test', ruleset: 'normal' });
    const cleanup = effects.at(-1)();
    return { sockets, notices, cleanup };
}
const snapshot = (serverNow, rematchUntil) => ({ ruleset: 'normal', revision: 1, game: {}, serverNow, rematchUntil });

test('client keeps the original 60-second window across snapshots and reconnects, then stops all socket activity', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
    const page = browser();
    try {
        const first = page.sockets[0]; first.open(); first.snapshot(snapshot(Date.now(), 1_060_000));
        t.mock.timers.tick(30_000);
        first.snapshot(snapshot(Date.now(), 1_060_000));
        t.mock.timers.tick(15_000);
        first.close(1012);
        t.mock.timers.tick(1000);
        assert.equal(page.sockets.length, 2);
        const second = page.sockets[1]; second.open(); second.snapshot(snapshot(Date.now(), 1_060_000));
        t.mock.timers.tick(13_999);
        assert.equal(second.readyState, 1);
        t.mock.timers.tick(1);
        assert.equal(second.readyState, 3);
        const messages = second.sent.length, updates = page.notices.length;
        t.mock.timers.tick(300_000);
        assert.equal(page.sockets.length, 2);
        assert.equal(second.sent.length, messages);
        assert.equal(page.notices.length, updates);
        assert.ok(page.notices.includes('Rematch window expired. Start a new match from the lobby.'));
    } finally { page.cleanup(); }
});

test('client stops immediately on an expired reload or server expiry close code', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_060_000 });
    for (const useSnapshot of [true, false]) {
        const page = browser();
        try {
            const socket = page.sockets[0]; socket.open();
            if (useSnapshot) socket.snapshot(snapshot(Date.now(), 1_060_000));
            else socket.close(4002);
            assert.equal(socket.readyState, 3);
            t.mock.timers.tick(300_000);
            assert.equal(page.sockets.length, 1);
            assert.equal(socket.sent.length, 0);
        } finally { page.cleanup(); }
    }
});
