import * as dblpLocal from './dblpLocal.js';
import { getAuthorPublications } from './hal.js';

// Teams are browser-local, therefore records are requested by supplying the
// source and member identifiers. This endpoint is read-only and returns the
// source records before presentation filters are applied by the caller.
export async function controllerTeamRecords(req, res) {
  const { source, pids } = req.body || {};
  if ((source !== 'dblp' && source !== 'hal') || !Array.isArray(pids) || pids.length === 0) {
    return res.status(400).json({ error: 'source must be dblp or hal and pids must be a non-empty array' });
  }
  try {
    let records;
    if (source === 'dblp') {
      const names = (await Promise.all(pids.map(pid => dblpLocal.getAuthorNames(pid)))).flat().filter(Boolean);
      records = await dblpLocal.getPublicationsByNames([...new Set(names)]);
      const seen = new Set();
      records = records.filter(record => !seen.has(record.dblp.key) && seen.add(record.dblp.key));
    } else {
      records = (await Promise.all(pids.map(idHal => getAuthorPublications(idHal)))).flat();
      const seen = new Set();
      records = records.filter(record => !seen.has(record.docid) && seen.add(record.docid));
    }
    res.json({ source, records });
  } catch (error) {
    console.log('Error retrieving team records', error);
    res.status(400).json({ error: error.message });
  }
}
