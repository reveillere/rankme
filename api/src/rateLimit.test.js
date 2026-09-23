import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from './rateLimit.js';

function callWith(middleware, ip) {
    const req = { ip };
    let statusCode = null;
    const res = {
        set: () => {},
        status(code) { statusCode = code; return this; },
        json: () => {},
    };
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    return nextCalled ? 200 : statusCode;
}

test('rateLimit: two independent instances do not share a bucket for the same IP', () => {
    // Regression test for a real bug: buckets used to live at module scope,
    // so routes.js's separate publicApiLimit and authLimit instances pooled
    // their counts together for the same caller -- hammering one route
    // could throttle an unrelated one instead of just itself.
    const a = rateLimit({ windowMs: 60_000, max: 1 });
    const b = rateLimit({ windowMs: 60_000, max: 1 });

    assert.equal(callWith(a, '1.2.3.4'), 200);
    assert.equal(callWith(b, '1.2.3.4'), 200, 'a fresh limiter for the same IP should not already be at capacity');
    assert.equal(callWith(a, '1.2.3.4'), 429, 'a is now over its own max');
    assert.equal(callWith(b, '1.2.3.4'), 429, 'b is now over its own max, independently of a');
});

test('rateLimit: distinct IPs on the same instance are tracked independently', () => {
    const limit = rateLimit({ windowMs: 60_000, max: 1 });

    assert.equal(callWith(limit, '1.1.1.1'), 200);
    assert.equal(callWith(limit, '2.2.2.2'), 200);
    assert.equal(callWith(limit, '1.1.1.1'), 429);
});
