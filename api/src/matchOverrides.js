import { getClient } from './db.js';

// A user-chosen correction to a CORE/SJR match, applied only in that
// user's own browser (see front/src/matchOverrides.js) but also mirrored
// here so we keep a server-side copy of every correction anyone makes --
// this is purely for later analysis (which venues keep getting
// mismatched, in what way) and is never read back to affect ranking.
async function collection() {
    const client = await getClient();
    return client.db('rankme').collection('matchOverrides');
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
            // signal to trust that pattern more, not to fix it.
            action: action === 'confirm' ? 'confirm' : 'override',
            // No account system here -- a per-browser random id (see front)
            // lets us later tell "10 different people fixed this" apart
            // from "one person fixed it 10 times", without identifying anyone.
            clientId: typeof clientId === 'string' ? clientId.slice(0, 100) : null,
            createdAt: new Date(),
        });
        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('[matchOverrides] Error recording override', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
