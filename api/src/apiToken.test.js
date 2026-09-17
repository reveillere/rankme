import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireApiToken } from './apiToken.js';

// configuredTokens() reads process.env.API_TOKENS fresh on every call (not
// cached at import time), so each test can set it directly.

function fakeReqRes({ headers = {} } = {}) {
    const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const req = { headers };
    return { req, res };
}

test('requireApiToken: rejects with 401 when no token is sent at all', () => {
    process.env.API_TOKENS = 'secret-token';
    const { req, res } = fakeReqRes();
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('requireApiToken: rejects with 401 when the token is wrong', () => {
    process.env.API_TOKENS = 'secret-token';
    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'wrong-token' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('requireApiToken: accepts a correct token via the X-API-Token header', () => {
    process.env.API_TOKENS = 'secret-token';
    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'secret-token' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
});

test('requireApiToken: accepts a correct token via Authorization: Bearer', () => {
    process.env.API_TOKENS = 'secret-token';
    const { req, res } = fakeReqRes({ headers: { authorization: 'Bearer secret-token' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('requireApiToken: a comma-separated list of tokens accepts any one of them', () => {
    process.env.API_TOKENS = 'first-token,second-token';
    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'second-token' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('requireApiToken: a "label:token" entry validates against the token half only', () => {
    process.env.API_TOKENS = 'partner-name:the-real-token';
    const rejectAttempt = fakeReqRes({ headers: { 'x-api-token': 'partner-name:the-real-token' } });
    let rejected = false;
    requireApiToken(rejectAttempt.req, rejectAttempt.res, () => { rejected = true; });
    assert.equal(rejected, false, 'the full "label:token" string must not itself be a valid token');

    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'the-real-token' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('requireApiToken: an unset API_TOKENS rejects every request, never fails open', () => {
    delete process.env.API_TOKENS;
    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'anything' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('requireApiToken: a token that is a prefix/suffix of the real one is still rejected', () => {
    process.env.API_TOKENS = 'secret-token';
    const { req, res } = fakeReqRes({ headers: { 'x-api-token': 'secret-toke' } });
    let nextCalled = false;
    requireApiToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});
