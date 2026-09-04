import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamRankedItems } from './ranking.js';

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

  await streamRankedItems(fakeRes(), items, () => true, computeRank);

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

  await streamRankedItems(res, items, (item) => item.rankable, async (item, index) => {
    ranked.push(index);
    return { rank: 'ok' };
  });

  assert.deepEqual(ranked, [0, 2]);
  const initEvent = res.events.find((e) => e.startsWith('event: init'));
  assert.match(initEvent, /"total":2/);
});
