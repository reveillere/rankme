import { createHash } from 'node:crypto';
import { dedupeInFlight } from './inFlight.js';

const TTL_SECONDS = 300;
const generationOf = status => JSON.stringify([status.version, status.importedAt]);

function unavailable(message) {
    return Object.assign(new Error(message), { status: 503 });
}

export function createDblpSearch({ getStatus, search, tokenize, cache }) {
    const inFlight = new Map();
    return async query => {
        const status = await getStatus();
        if (!status.ready) {
            throw unavailable(status.importing ? 'DBLP local dump import in progress' : 'DBLP local dump not imported yet');
        }
        const generation = generationOf(status);
        const words = [...new Set(tokenize(query))].sort();
        if (!words.length) return [];
        // Namespace by both version and import time: reimporting even the
        // same dump must not reuse results from the previous database.
        const hash = createHash('sha256').update(JSON.stringify([generation, words])).digest('hex');
        const key = `dblp:local-search:v1:${hash}`;
        return dedupeInFlight(inFlight, key, async () => {
            let result;
            try {
                result = await cache.get(key);
            } catch {
                // A cache outage must not prevent local Mongo searches.
            }
            const hit = Array.isArray(result);
            if (!hit) result = await search(query);
            // An import can start while Mongo or Redis is answering. Never
            // serve or cache that result as a valid snapshot.
            const current = await getStatus();
            if (!current.ready || generationOf(current) !== generation) {
                throw unavailable('DBLP local dump changed during search; please retry');
            }
            if (!hit) {
                try { await cache.set(key, result, TTL_SECONDS); } catch { /* best-effort cache */ }
            }
            return result;
        });
    };
}
