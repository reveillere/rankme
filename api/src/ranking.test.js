import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { streamRankedItems } from './ranking.js';
import { setImmediate as nextTurn } from 'node:timers/promises';

function fakeRes() {
  const events = [];
  return {
    writeHead: () => {},
    flushHeaders: () => {},
    write: (chunk) => events.push(chunk),
    end: () => {},
    events,
  };
}

// streamRankedItems listens for the request's 'close' event (see ranking.js)
// -- a plain EventEmitter is enough to stand in for req here, since that's
// the only thing it's used for.
function fakeReq() {
  return new EventEmitter();
}

test('streamRankedItems caps concurrent computeRank calls regardless of item count', async () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ id: i }));
  let inFlight = 0;
  let maxInFlight = 0;

  const computeRank = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    return { rank: 'x' };
  };

  await streamRankedItems(fakeReq(), fakeRes(), items, () => true, computeRank);

  // A prolific author (hundreds of publications) launching every ranking
  // computation at once via an uncapped Promise.all OOM-killed the api
  // process in practice — this pins the concurrency cap so that regresses
  // loudly instead of silently, next time under real load.
  assert.ok(maxInFlight <= 8, `expected at most 8 concurrent computations, saw ${maxInFlight}`);
  assert.ok(maxInFlight > 1, 'sanity check: some concurrency should still happen');
});

test('streamRankedItems only ranks items isRankable selects, and reports the smaller total', async () => {
  const items = [{ rankable: true }, { rankable: false }, { rankable: true }];
  const res = fakeRes();
  const ranked = [];

  await streamRankedItems(fakeReq(), res, items, (item) => item.rankable, async (item, index) => {
    ranked.push(index);
    return { rank: 'ok' };
  });

  assert.deepEqual(ranked, [0, 2]);
  const initEvent = res.events.find((e) => e.startsWith('event: init'));
  assert.match(initEvent, /"total":2/);
});

test('streamRankedItems accepts a priority-scheduled job and behaves normally with no contention', async () => {
  // Not a rigorous load test -- just confirms the priority-bucketed
  // ConcurrencyLimiter (see ranking.js) accepts the priority streamRankedItems
  // passes to schedule() (see priorityFor) without throwing, and that a
  // single small request still completes exactly as before.
  const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  const res = fakeRes();
  const ranked = [];

  await streamRankedItems(fakeReq(), res, items, () => true, async (item, index) => {
    ranked.push(index);
    return { rank: 'ok' };
  });

  assert.deepEqual(ranked, [0, 1, 2, 3, 4]);
  assert.ok(res.events.some((e) => e.startsWith('event: done')));
});

test('streamRankedItems skips scheduling work once the client has already disconnected', async () => {
  const req = fakeReq();
  const res = fakeRes();
  const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  let calls = 0;
  const computeRank = async () => { calls++; return { rank: 'x' }; };

  // Fired synchronously right after the call below: streamRankedItems runs
  // synchronously up to its first await (Promise.all), which is after the
  // 'close' listener is registered but before any ranking_limiter.schedule
  // callback actually runs -- so this is a deterministic "client vanished
  // before any ranking work started" case, not a timing-dependent one.
  const promise = streamRankedItems(req, res, items, () => true, computeRank);
  req.emit('close');
  await promise;

  assert.equal(calls, 0, 'no ranking work should run once the request already closed');
});

test('streamRankedItems reports a queue position when the limiter is already saturated, then starts once a slot frees up', async () => {
  // Blocks every item on a gate this test controls, so the first request's
  // own 20 items (priority 2, same bucket the second request's 3 items
  // below also land in -- both totals are < 50, see priorityFor) fill all
  // 8 concurrency slots and leave 12 of themselves still queued behind
  // those slots.
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const blockingComputeRank = async () => { await gate; return {}; };

  const items1 = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  const p1 = streamRankedItems(fakeReq(), fakeRes(), items1, () => true, blockingComputeRank, 'blocker');

  // Lets the first batch's schedule()/_drain() calls actually run (each is
  // just a microtask tick past `await Promise.resolve()`, see
  // ConcurrencyLimiter._run) before the second request joins the queue.
  await new Promise((r) => setTimeout(r, 20));

  const res2 = fakeRes();
  const items2 = Array.from({ length: 3 }, (_, i) => ({ id: i }));
  const p2 = streamRankedItems(fakeReq(), res2, items2, () => true, async () => ({}), 'waiter');
  await new Promise((r) => setTimeout(r, 20));

  const queuedLine = res2.events.find((e) => e.includes('event: queued'));
  assert.ok(queuedLine, 'expected a queued event while the limiter is saturated');
  const queuedData = JSON.parse(queuedLine.match(/data: (.*)\n\n$/)[1]);
  // Exactly the 12 of the first request's own items still sitting in the
  // same priority bucket -- its other 8 are already running, not queued.
  assert.equal(queuedData.position, 12);
  assert.ok(!res2.events.some((e) => e.includes('event: started')), 'should not have started yet');

  releaseGate();
  await Promise.all([p1, p2]); // fully drain so later tests see a clean limiter

  assert.ok(res2.events.some((e) => e.includes('event: started')));
  assert.ok(res2.events.some((e) => e.startsWith('event: done')));
});

function queuedPositions(res) {
  return res.events.filter(e => e.startsWith('event: queued')).map(e => JSON.parse(e.match(/data: (.*)\n/)[1]).position);
}

function gates(count) {
  const release = [];
  const promises = Array.from({ length: count }, () => new Promise(resolve => release.push(resolve)));
  return { release, compute: async (_, index) => { await promises[index]; return {}; } };
}

test('queue position decreases while waiting and excludes own tasks and later same-priority arrivals', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const gate = gates(20);
  const blocker = streamRankedItems(fakeReq(), fakeRes(), Array(20).fill({}), () => true, gate.compute);
  const res = fakeRes();
  const waiter = streamRankedItems(fakeReq(), res, Array(3).fill({}), () => true, async () => ({}));
  const later = streamRankedItems(fakeReq(), fakeRes(), Array(4).fill({}), () => true, async () => ({}));
  try {
    assert.deepEqual(queuedPositions(res), [12]);
    gate.release.slice(0, 8).forEach(release => release());
    await nextTurn();
    t.mock.timers.tick(1000);
    assert.deepEqual(queuedPositions(res), [12, 4]);
    assert.ok(!res.events.some(e => e.startsWith('event: started')));
    t.mock.timers.tick(1000);
    assert.deepEqual(queuedPositions(res), [12, 4], 'unchanged positions are not resent');
    gate.release.slice(8, 12).forEach(release => release());
    await nextTurn();
    t.mock.timers.tick(1000);
    assert.deepEqual(queuedPositions(res), [12, 4, 0], 'next in line while all eight slots still run');
  } finally {
    gate.release.forEach(release => release());
    await Promise.all([blocker, waiter, later]);
  }
  const positions = queuedPositions(res);
  t.mock.timers.tick(5000);
  assert.deepEqual(queuedPositions(res), positions);
  assert.equal(res.events.filter(e => e.startsWith('event: started')).length, 1);
  const startedAt = res.events.findIndex(e => e.startsWith('event: started'));
  assert.ok(!res.events.slice(startedAt).some(e => e.startsWith('event: queued')));
});

test('queue position includes new higher-priority tasks but stops updates on disconnect', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const gate = gates(60);
  const blocker = streamRankedItems(fakeReq(), fakeRes(), Array(60).fill({}), () => true, gate.compute);
  const req = fakeReq();
  const res = fakeRes();
  let calls = 0;
  const waiter = streamRankedItems(req, res, Array(60).fill({}), () => true, async () => { calls++; return {}; });
  const priority = streamRankedItems(fakeReq(), fakeRes(), Array(3).fill({}), () => true, async () => ({}));
  try {
    assert.deepEqual(queuedPositions(res), [52]);
    t.mock.timers.tick(1000);
    assert.deepEqual(queuedPositions(res), [52, 55]);
    req.emit('close');
    gate.release.slice(0, 8).forEach(release => release());
    await nextTurn();
    t.mock.timers.tick(5000);
    assert.deepEqual(queuedPositions(res), [52, 55]);
  } finally {
    gate.release.forEach(release => release());
    await Promise.all([blocker, waiter, priority]);
  }
  assert.equal(calls, 0);
  assert.equal(req.listenerCount('close'), 1, 'queue-update listener is removed');
});
