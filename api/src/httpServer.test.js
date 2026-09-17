import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from './routes.js';
import { rateLimit } from './rateLimit.js';

// Real HTTP, real listening server, real fetch() calls -- unlike every
// other test in this suite (pure cores with injected I/O, or router.stack
// introspection without ever sending a request), these hit the network for
// real. Deliberately scoped to what's testable without a live Mongo/Redis/
// HAL/DBLP behind it: auth rejection and rate limiting both short-circuit
// in requireApiToken/rateLimit.js *before* any controller runs, so no
// controller here is ever actually invoked (see verified-no-DB-needed
// comments per test). A real "does /dblp/author/<pid> return the right
// ranked JSON" test would need a live database and network mocking neither
// exists in this repo's test setup -- out of scope here, see the api/
// section of the code review this closed a gap from.
//
// index.js's own CORS setup isn't covered here either: index.js calls
// start() (network/Mongo calls, then app.listen()) at module scope, so it
// can't be imported in a test without those side effects -- would need
// index.js's app construction split from its start()/listen() first.

async function listen(app) {
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('GET /health responds 200 over real HTTP -- no database touched (see routes.js\'s own comment)', async () => {
    const { server, baseUrl } = await listen(express().use(router));
    try {
        const resp = await fetch(`${baseUrl}/health`);
        assert.equal(resp.status, 200);
        assert.deepEqual(await resp.json(), { status: 'ok' });
    } finally {
        server.close();
    }
});

// One path per requireApiToken-protected route in routes.js -- dummy
// path params (pid/idHal/structId) are never read: requireApiToken rejects
// before Express even resolves them into a controller call, so no
// database is touched by any of these.
const PROTECTED_ROUTES = [
    ['POST', '/dblp/author/11/1262'],
    ['POST', '/hal/author/some-id'],
    ['POST', '/hal/structure/123'],
    ['POST', '/records/team'],
    ['POST', '/crosscheck/author'],
    ['POST', '/crosscheck/structure'],
    ['POST', '/crosscheck/team'],
];

test('every requireApiToken-protected route rejects an unauthenticated request with 401 over real HTTP', async () => {
    const { server, baseUrl } = await listen(express().use(express.json()).use(router));
    try {
        for (const [method, path] of PROTECTED_ROUTES) {
            const resp = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
            assert.equal(resp.status, 401, `${method} ${path} should reject an unauthenticated request`);
        }
    } finally {
        server.close();
    }
});

test('a wrong API token is also rejected with 401 over real HTTP, not just a missing one', async () => {
    const { server, baseUrl } = await listen(express().use(express.json()).use(router));
    try {
        const resp = await fetch(`${baseUrl}/records/team`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Token': 'not-the-real-token' },
            body: '{}',
        });
        assert.equal(resp.status, 401);
    } finally {
        server.close();
    }
});

// Isolated from routes.js entirely -- this exercises the real rateLimit.js
// middleware directly against a throwaway route, so a controller (and the
// database it would need) is never in the picture. windowMs is long enough
// that the whole test (a handful of requests) can't cross a window
// boundary and reset mid-run.
test('rateLimit middleware returns 429 with a Retry-After header once the configured max is exceeded, over real HTTP', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const app = express().get('/toy', limiter, (req, res) => res.json({ ok: true }));
    const { server, baseUrl } = await listen(app);
    try {
        for (let i = 1; i <= 3; i++) {
            const resp = await fetch(`${baseUrl}/toy`);
            assert.equal(resp.status, 200, `request ${i} should still pass`);
        }
        const blocked = await fetch(`${baseUrl}/toy`);
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    } finally {
        server.close();
    }
});
