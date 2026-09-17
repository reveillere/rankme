import { getClient } from './db.js';

// Every ranking source that carries a fuzzy/approximate automatic match a
// user might need to correct -- CORE and SJR were the only two originally
// wired up here (controllerRecord/controllerSharedList below both rejected
// anything else with a 400), but CCF's own HAL-venue fuzzy match
// (ccfPortal.js's getRankForHalVenue) is exactly as capable of mismatching
// a venue, and front/src/matchOverrides.js's setOverride/confirmMatch never
// actually restricted personal overrides to core/sjr in the first place --
// only the community-promotion path (this file) did, with no recorded
// reason to. Kept as one list so a future ranking source only needs adding
// here, not re-auditing both endpoints separately.
const KNOWN_PORTALS = ['core', 'sjr', 'ccf'];

// A user-chosen correction to a CORE/SJR/CCF match, applied only in that
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
        // This collection is an unbounded audit log (one document per
        // correction ever submitted, by anyone) -- a TTL index keeps it from
        // growing forever. Two years comfortably outlives any single ranking
        // edition's relevance for the "which venues keep getting
        // mismatched" analysis this exists for.
        col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 2 })
            .catch((error) => console.error('[matchOverrides] Error creating TTL index', error));
    }
    return col;
}

// Community-confirmed corrections: one document per (source, venueText),
// read back by every client (see controllerSharedList) once promoted.
// Keyed on venueText alone, not the ranking edition a given submission
// happened to be computed against (unlike a personal override, see the
// note in front/src/matchOverrides.js) -- the same exact venue text almost
// always identifies the same CORE/SJR/CCF entry regardless of which year's
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
// from "one person's correction" to "shown to everyone by default". High
// enough that one person can't unilaterally rewrite a shared result by
// resubmitting (distinct() only counts each clientId once regardless of
// how many times they submit, so that specific attack doesn't work either
// way -- this is really about requiring broad independent agreement before
// a correction goes live for every visitor, not about resisting any one
// browser's volume).
const PROMOTION_THRESHOLD = 10;

function sharedKey(source, venueText) {
    return `${source}:${venueText}`;
}

export async function controllerRecord(req, res) {
    const { source, year, venueText, previousMatch, newMatch, clientId, action } = req.body || {};
    if (!KNOWN_PORTALS.includes(source)) {
        res.status(400).json({ error: 'Bad Request', message: `source must be one of: ${KNOWN_PORTALS.join(', ')}` });
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

// Every community-confirmed correction for one portal, keyed by venueText --
// the shape front/src/matchOverrides.js's resolveEffectiveValue (sharedMap
// param) and api/src/recordPresentation.js's own correction pipeline both
// expect. Empty (not an error) for an unknown portal -- callers that just
// want "whatever community corrections exist for this portal, if any"
// (recordPresentation.js loops over every portal actually present in a
// batch) shouldn't need to pre-validate against KNOWN_PORTALS themselves;
// controllerSharedList below still validates for its own direct callers.
export async function getSharedOverridesMap(portal) {
    if (!KNOWN_PORTALS.includes(portal)) return {};
    const shared = await sharedCollection();
    const docs = await shared.find({ source: portal }, { projection: { _id: 0, venueText: 1, candidate: 1, confirmedCount: 1 } }).toArray();
    return Object.fromEntries(docs.map((d) => [d.venueText, { venueText: d.venueText, candidate: d.candidate, confirmedCount: d.confirmedCount }]));
}

// The front end fetches this once per portal per page load (see
// fetchSharedOverrides, front/src/matchOverrides.js) and checks it before
// falling back to the automatic match, whenever there's no personal
// override for that exact text (personal always wins -- see
// getOverride/getSharedOverride). Kept as a plain array (not
// getSharedOverridesMap's {[venueText]: entry} shape) since that's this
// endpoint's own established, already-consumed response contract.
export async function controllerSharedList(req, res) {
    const { portal } = req.params;
    if (!KNOWN_PORTALS.includes(portal)) {
        res.status(400).json({ error: 'Bad Request', message: `portal must be one of: ${KNOWN_PORTALS.join(', ')}` });
        return;
    }
    try {
        const map = await getSharedOverridesMap(portal);
        res.json(Object.values(map));
    } catch (error) {
        console.error('[matchOverrides] Error listing shared overrides', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
