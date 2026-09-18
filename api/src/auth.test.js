import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken } from './auth.js';

test('session tokens round-trip and expire', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'a'.repeat(32);
  try {
    const now = 1_700_000_000_000;
    const token = createSessionToken('507f1f77bcf86cd799439011', now);
    assert.deepEqual(verifySessionToken(token, now + 1).userId, '507f1f77bcf86cd799439011');
    assert.equal(verifySessionToken(`${token}x`, now), null);
    assert.equal(verifySessionToken(token, now + 30 * 24 * 60 * 60 * 1000 + 1), null);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
