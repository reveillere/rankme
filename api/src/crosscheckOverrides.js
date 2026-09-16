import { getClient } from './db.js';

// ****************************************************************************************************
// ****************************************************************************************************
// A maintainer's yes/no decision on one specific (dblp publication, HAL
// candidate) pair that crosscheck.js's automatic matching flagged as
// 'to-review' (or, for a rejection, even an already-'confirmed' exact/strong
// match). Modeled on identityResolution.js's personLinks -- a plain
// upsert-by-key objective fact -- rather than matchOverrides.js's
// corroboration-threshold mechanism: there is nothing to corroborate here.
// The maintainer looked at the two publications side by side and knows
// whether they're the same paper; a later decision on the exact same pair
// simply replaces the earlier one, no accumulated history needed.

let overridesIndexEnsured = false;
async function collection() {
    const client = await getClient();
    const col = client.db('rankme').collection('crosscheckOverrides');
    if (!overridesIndexEnsured) {
        overridesIndexEnsured = true;
        col.createIndex({ dblpKey: 1, halDocid: 1 }, { unique: true })
            .catch(error => console.error('[crosscheckOverrides] Error creating index', error));
    }
    return col;
}

// Scoped to the caller's own dblpKeys (crosscheck.js's getCrossCheckReport
// only ever needs the decisions for the pid it's currently reporting on) --
// returns a Map<dblpKey, Map<halDocid, 'same'|'different'>>. A dblpKey with
// no recorded decision is simply absent from the outer map, and a halDocid
// the caller never asks about is simply absent from the inner one -- either
// way, nothing to apply, no crash.
export async function getOverridesByDblpKey(dblpKeys) {
    const byDblpKey = new Map();
    if (dblpKeys.length === 0) return byDblpKey;
    const col = await collection();
    const docs = await col.find(
        { dblpKey: { $in: dblpKeys } },
        { projection: { dblpKey: 1, halDocid: 1, decision: 1 } },
    ).toArray();
    for (const doc of docs) {
        if (!byDblpKey.has(doc.dblpKey)) byDblpKey.set(doc.dblpKey, new Map());
        byDblpKey.get(doc.dblpKey).set(doc.halDocid, doc.decision);
    }
    return byDblpKey;
}

export async function controllerRecord(req, res) {
    const { dblpKey, halDocid, decision } = req.body || {};
    if (!dblpKey || !halDocid) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing dblpKey or halDocid' });
        return;
    }
    if (decision !== 'same' && decision !== 'different') {
        res.status(400).json({ error: 'Bad Request', message: 'decision must be "same" or "different"' });
        return;
    }
    // Audit-only, on the model of matchOverrides.js's own clientId -- not
    // tied to any account, and never used to tell decisions apart (unlike
    // matchOverrides.js's corroboration count, there's only ever one
    // decision on file per pair, see the upsert below).
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 100) : null;
    try {
        const col = await collection();
        await col.updateOne(
            { dblpKey, halDocid },
            { $set: { dblpKey, halDocid, decision, clientId, createdAt: new Date() } },
            { upsert: true },
        );
        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('[crosscheckOverrides] Error recording override', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
