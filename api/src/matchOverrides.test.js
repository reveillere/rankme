import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickConsensusCandidate } from './matchOverrides.js';

function votesFor(candidateId, count) {
    return Array.from({ length: count }, () => ({ newMatch: { id: candidateId } }));
}

test('pickConsensusCandidate: returns null when too few respondents', () => {
    const votes = votesFor('A', 10);
    assert.equal(pickConsensusCandidate(votes), null);
});

test('pickConsensusCandidate: returns null when no candidate reaches the ratio', () => {
    const votes = [...votesFor('A', 6), ...votesFor('B', 5)]; // 11 total, A only ~55%
    assert.equal(pickConsensusCandidate(votes), null);
});

test('pickConsensusCandidate: promotes the majority candidate once past the ratio and minimum', () => {
    const votes = [...votesFor('A', 20), ...votesFor('B', 2)]; // 22 total, A at ~91%
    const decision = pickConsensusCandidate(votes);
    assert.deepEqual(decision, { candidate: { id: 'A' }, confirmedCount: 20 });
});

test('pickConsensusCandidate: does not let a late-arriving minority flip a settled majority', () => {
    // Same scenario the "last write wins" bug used to mishandle: A has a
    // strong majority even though B also individually clears the old
    // absolute threshold of 10.
    const votes = [...votesFor('A', 20), ...votesFor('B', 10)]; // 30 total, A at ~67%
    assert.equal(pickConsensusCandidate(votes), null);
});

test('pickConsensusCandidate: respects custom thresholds', () => {
    const votes = [...votesFor('A', 4), ...votesFor('B', 1)]; // 5 total, A at 80%
    assert.equal(pickConsensusCandidate(votes, { minResponses: 10, ratio: 0.9 }), null);
    assert.deepEqual(
        pickConsensusCandidate(votes, { minResponses: 3, ratio: 0.8 }),
        { candidate: { id: 'A' }, confirmedCount: 4 },
    );
});
