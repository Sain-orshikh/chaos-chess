import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startGoogle, googleCallbackHandler } from '../backend/controllers/google.controller.js';
import User from '../backend/models/user.model.js';
import { publicUser } from '../backend/controllers/auth.controller.js';

process.env.JWT_SECRET = 'test-google-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
function response() {
    return { cookies: [], clearCookie() {}, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, cookie(...args) { this.cookies.push(args); }, redirect(url) { this.url = url; return this; } };
}
function request(claims = {}, query = {}) {
    return { cookies: { google_oauth: jwt.sign({ state: 'state', nonce: 'nonce', verifier: 'verifier', ...claims }, process.env.JWT_SECRET, { audience: 'google-oauth', expiresIn: '10m' }) }, query: { state: 'state', code: 'code', ...query } };
}
test('Google start uses PKCE, profile scope, and a browser-bound expiring flow cookie', () => {
    const res = response(); startGoogle({}, res);
    const url = new URL(res.url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url.searchParams.get('scope'), /profile/);
    const [name, token, options] = res.cookies[0];
    assert.equal(name, 'google_oauth'); assert.equal(options.sameSite, 'lax'); assert.equal(options.httpOnly, true);
    const flow = jwt.verify(token, process.env.JWT_SECRET, { audience: 'google-oauth' });
    assert.equal(flow.state, url.searchParams.get('state'));
    assert.equal(flow.nonce, url.searchParams.get('nonce'));
    assert.equal(flow.exp - flow.iat, 600);
});
test('invalid, missing, expired, or mismatched state cannot exchange a code', async () => {
    const callback = googleCallbackHandler(() => ({ origin: 'https://havoc-chess.vercel.app', client: { getToken() { assert.fail('must not exchange'); } } }));
    const expired = request(); expired.cookies.google_oauth = jwt.sign({ state: 'state' }, process.env.JWT_SECRET, { audience: 'google-oauth', expiresIn: -1 });
    for (const req of [{ cookies: {}, query: {} }, request({}, { state: 'wrong' }), request({}, { state: ['state'] }), request({}, { code: ['code'] }), expired]) {
        const res = response(); await callback(req, res); assert.match(res.url, /google_failed$/); assert.equal(res.cookies.length, 0);
    }
});
test('nonce mismatch prevents database access and session creation', async () => {
    const callback = googleCallbackHandler(() => ({ origin: 'https://havoc-chess.vercel.app', client: {
        async getToken() { return { tokens: { id_token: 'verified-by-mock' } }; },
        async verifyIdToken() { return { getPayload: () => ({ sub: 'google-user', nonce: 'wrong' }) }; },
    } }));
    const res = response(); await callback(request(), res); assert.match(res.url, /google_failed$/); assert.equal(res.cookies.length, 0);
});
test('verified Google identity creates a passwordless account with its real display name, then reuses it', async () => {
    const originalFind = User.findOne, originalCreate = User.create;
    let saved, creates = 0;
    User.findOne = async query => { assert.deepEqual(query, { googleId: 'google-user' }); return saved; };
    User.create = async data => { creates++; saved = { ...data, _id: 'abcdefabcdefabcdefabcdef' }; return saved; };
    try {
        const callback = googleCallbackHandler(() => ({ origin: 'https://havoc-chess.vercel.app', client: {
            async getToken(options) { assert.deepEqual(options, { code: 'code', codeVerifier: 'verifier' }); return { tokens: { id_token: 'token' } }; },
            async verifyIdToken(options) { assert.equal(options.audience, 'test-client'); return { getPayload: () => ({ sub: 'google-user', nonce: 'nonce', name: 'Kim Chess' }) }; },
        } }));
        for (let i = 0; i < 2; i++) {
            const res = response(); await callback(request(), res); assert.equal(res.url, 'https://havoc-chess.vercel.app/');
            assert.equal(res.cookies[0][0], 'jwt');
        }
        assert.equal(creates, 1); assert.equal(saved.displayName, 'Kim Chess'); assert.equal(saved.password, undefined);
        const user = publicUser(saved); assert.equal(user.displayName, 'Kim Chess'); assert.equal(user.hasPassword, false); assert.equal(user.googleId, undefined);
        await new User(saved).validate();
    } finally { User.findOne = originalFind; User.create = originalCreate; }
});
test('password accounts retain their username display and required password', async () => {
    assert.equal(publicUser({ username: 'Player_123' }).displayName, 'Player_123');
    assert.equal(publicUser({ username: 'Player_123' }).hasPassword, true);
    await assert.rejects(new User({ username: 'Player_123' }).validate());
});
