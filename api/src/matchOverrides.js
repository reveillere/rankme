import { getClient } from './db.js';

// A user-chosen correction to a CORE/SJR match, applied only in that
// user's own browser (see front/src/matchOverrides.js) but also mirrored
// here so we keep a server-side copy of every correction anyone makes --
// used both for later analysis (which venues keep getting mismatched, in
// what way) and, once enough distinct browsers agree, to promote a
// correction into sharedMatchOverrides below so everyone benefits from it,
// not just whoever found it first.
let auditIndexEnsured = false;
async function collection() {
    const client = await getClient();
    const col = client.db('rankme').collection('matchOverrides');
    if (!auditIndexEnsured) {
        auditIndexEnsured = true;
        // Backs the distinct-clientId corroboration check below.
        col.createIndex({ source: 1, venueText: 1, 'newMatch.id': 1 })
            .catch((error) => console.error('[matchOverrides] Error creating audit index', error));
    }
    return col;
}

// Community-confirmed corrections: one document per (source, venueText),
// read back by every client (see controllerSharedList) once promoted.
// Keyed on venueText alone, not the ranking edition a given submission
// happened to be computed against (unlike a personal override, see the
// note in front/src/matchOverrides.js) -- the same exact venue text almost
// always identifies the same CORE/SJR entry regardless of which year's
// snapshot someone was looking at when they corrected it, and keying this
// way is what lets corroboration accumulate across different people/years
// in the first place.
let sharedIndexEnsured = false;
async function sharedCollection() {
    const client = await getClient();
    const col = client.db('rankme').collection('sharedMatchOverrides');
    if (!sharedIndexEnsured) {
        sharedIndexEnsured = true;
        col.createIndex({ source: 1 }).catch((error) => console.error('[matchOverrides] Error creating shared index', error));
    }
    return col;
}

// How many distinct browsers (see clientId below) need to independently
// land on the same (source, venueText) -> candidate before it's promoted
// from "one person's correction" to "shown to everyone by default". Low
// enough to actually promote things on a small/low-traffic site, high
// enough that one person can't unilaterally rewrite a shared result by
// resubmitting (distinct() only counts each clientId once regardless of
// how many times they submit, so that specific attack doesn't work either
// way -- this is really about requiring independent agreement, not about
// resisting any one browser's volume).
const PROMOTION_THRESHOLD = 3;

function sharedKey(source, venueText) {
    return `${source}:${venueText}`;
}

export async function controllerRecord(req, res) {
    const { source, year, venueText, previousMatch, newMatch, clientId, action } = req.body || {};
    if (source !== 'core' && source !== 'sjr') {
        res.status(400).json({ error: 'Bad Request', message: 'source must be "core" or "sjr"' });
        return;
    }
    if (!venueText || !newMatch?.id) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing venueText or newMatch' });
        return;
    }
    const normalizedClientId = typeof clientId === 'string' ? clientId.slice(0, 100) : null;
    const normalizedAction = action === 'confirm' ? 'confirm' : 'override';
    try {
        const col = await collection();
        await col.insertOne({
            source,
            year: Number.isFinite(year) ? year : null,
            venueText,
            previousMatch: previousMatch ?? null,
            newMatch,
            // 'override': the user picked a different entry. 'confirm': the
            // user verified an approximate automatic match is actually
            // correct as-is (previousMatch and newMatch are then the same
            // entry) -- distinguishing the two matters for rule-tuning,
            // since a pile of confirmations for the same fuzzy match is a
            // signal to trust that pattern more, not to fix it. Both count
            // equally toward promotion below: either way, this clientId is
            // asserting "newMatch is the right entry for this text".
            action: normalizedAction,
            // No account system here -- a per-browser random id (see front)
            // lets us later tell "10 different people fixed this" apart
            // from "one person fixed it 10 times", without identifying anyone.
            clientId: normalizedClientId,
            createdAt: new Date(),
        });

        if (normalizedClientId) {
            const distinctClientIds = await col.distinct('clientId', {
                source, venueText, 'newMatch.id': newMatch.id, clientId: { $ne: null },
            });
            if (distinctClientIds.length >= PROMOTION_THRESHOLD) {
                const shared = await sharedCollection();
                await shared.updateOne(
                    { _id: sharedKey(source, venueText) },
                    {
                        $set: { source, venueText, candidate: newMatch, confirmedCount: distinctClientIds.length, updatedAt: new Date() },
                        $setOnInsert: { promotedAt: new Date() },
                    },
                    { upsert: true },
                );
            }
        }

        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('[matchOverrides] Error recording override', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

// Every community-confirmed correction for one portal -- the front end
// fetches this once per portal per page load (see fetchSharedOverrides,
// front/src/matchOverrides.js) and checks it before falling back to the
// automatic match, whenever there's no personal override for that exact
// text (personal always wins -- see getOverride/getSharedOverride).
export async function controllerSharedList(req, res) {
    const { portal } = req.params;
    if (portal !== 'core' && portal !== 'sjr') {
        res.status(400).json({ error: 'Bad Request', message: 'portal must be "core" or "sjr"' });
        return;
    }
    try {
        const shared = await sharedCollection();
        const docs = await shared.find({ source: portal }, { projection: { venueText: 1, candidate: 1, confirmedCount: 1 } }).toArray();
        res.json(docs.map((d) => ({ venueText: d.venueText, candidate: d.candidate, confirmedCount: d.confirmedCount })));
    } catch (error) {
        console.error('[matchOverrides] Error listing shared overrides', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
