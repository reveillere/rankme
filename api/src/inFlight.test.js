import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeInFlight } from './inFlight.js';

// sjrPortal.js/corePortal.js/hal.js all use this to collapse two concurrent
// callers asking for the same not-yet-cached key (e.g. two browser tabs
// requesting the same HAL structure, or two publications ranking the same
// venue string) into a single underlying computation instead of two.
test('dedupeInFlight runs the underlying computation once for concurrent callers sharing a key', async () => {
  const map = new Map();
  let calls = 0;
  const compute = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return 'result';
  };

  const [a, b] = await Promise.all([
    dedupeInFlight(map, 'same-key', compute),
    dedupeInFlight(map, 'same-key', compute),
  ]);

  assert.equal(calls, 1, 'both concurrent callers should share the same in-flight computation');
  assert.equal(a, 'result');
  assert.equal(b, 'result');
});

test('dedupeInFlight keeps distinct keys independent', async () => {
  const map = new Map();
  let calls = 0;
  const compute = async (label) => {
    calls++;
    return label;
  };

  const [a, b] = await Promise.all([
    dedupeInFlight(map, 'key-a', () => compute('a')),
    dedupeInFlight(map, 'key-b', () => compute('b')),
  ]);

  assert.equal(calls, 2, 'different keys must not be coalesced together');
  assert.equal(a, 'a');
  assert.equal(b, 'b');
});

test('dedupeInFlight cleans up so a later call for the same key runs again', async () => {
  const map = new Map();
  let calls = 0;
  const compute = async () => { calls++; return calls; };

  const first = await dedupeInFlight(map, 'k', compute);
  assert.equal(map.has('k'), false, 'the map entry should be removed once the promise settles');
  const second = await dedupeInFlight(map, 'k', compute);

  assert.equal(first, 1);
  assert.equal(second, 2, 'a call after the first has settled should trigger a fresh computation, not reuse the old one');
});
