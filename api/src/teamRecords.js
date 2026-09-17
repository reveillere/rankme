import * as dblpLocal from './dblpLocal.js';
import { getAuthorPublications } from './hal.js';
import { mapWithConcurrency } from './concurrency.js';
import { respondWithRecords } from './recordPresentation.js';

// Mirrors crosscheckStructure.js/crosscheckTeam.js's own reasoning: a handful
// of HAL calls in parallel, not Promise.all with no cap, to stay polite to
// the shared HAL rate limiter (throttler.js) when a team has many members.
const MEMBER_CONCURRENCY = 4;

// Teams are browser-local, therefore records are requested by supplying the
// source and member identifiers. This endpoint is read-only, has no
// frontend caller of its own (see routes.js), and returns the merged,
// deduplicated, ranked, filtered/sorted records per recordPresentation.js.
export async function controllerTeamRecords(req, res) {
  const { source, pids } = req.body || {};
  if ((source !== 'dblp' && source !== 'hal') || !Array.isArray(pids) || pids.length === 0) {
    return res.status(400).json({ error: 'source must be dblp or hal and pids must be a non-empty array' });
  }
  try {
    let records;
    if (source === 'dblp') {
      const namesByPid = await dblpLocal.getAuthorNamesByPids(pids);
      const names = [...namesByPid.values()].flat().filter(Boolean);
      records = await dblpLocal.getPublicationsByNames([...new Set(names)]);
      const seen = new Set();
      records = records.filter(record => !seen.has(record.dblp.key) && seen.add(record.dblp.key));
    } else {
      records = (await mapWithConcurrency(pids, MEMBER_CONCURRENCY, idHal => getAuthorPublications(idHal))).flat();
      const seen = new Set();
      records = records.filter(record => !seen.has(record.docid) && seen.add(record.docid));
    }
    await respondWithRecords(req, res, records, source, `${source.toUpperCase()} team records`, finalRecords => ({ source, records: finalRecords }));
  } catch (error) {
    console.log('Error retrieving team records', error);
    res.status(400).json({ error: error.message });
  }
}
