import * as cache from './cache.js';
import * as dblpLocal from './dblpLocal.js';
import * as admin from './admin.js';
import { createDblpSearch } from './dblpSearchCache.js';

export async function controllerAuthor(req, res) {
    const authorPID = req.params[0] || req.params.pid || req.body?.pid;
    try {
        // Local dump only -- see admin.js's dagstuhlDumpUrls/extractVenues:
        // the dump this serves from is fetched from Dagstuhl's DROPS mirror
        // now, not dblp.org live. Only the display name is needed here
        // (Author.js reads author.dblpperson.$.name), so this fabricates
        // just enough of the old live endpoint's shape for that to work.
        //
        // Also guards against a rebuild in progress: processXML drops
        // inproceedings/article/www at the *start* of a reimport (see
        // admin.js), so without this a lookup mid-import could see partial
        // or no data and misreport "not found" instead of "come back once
        // the import is done".
        const status = await admin.getDblpStatus();
        if (!status.ready) {
            res.status(503).json({ error: status.importing ? 'DBLP local dump import in progress' : 'DBLP local dump not imported yet' });
            return;
        }
        const localNames = await dblpLocal.getAuthorNames(authorPID);
        if (localNames == null) {
            res.status(404).json({ error: `No local DBLP record for PID ${authorPID}` });
            return;
        }
        // The browser's legacy GET only needs the display name. The
        // documented POST API is the records endpoint, so it returns the
        // actual DBLP publications too.
        if (req.method === 'POST') {
            const records = await dblpLocal.getPublicationsByNames(localNames);
            res.json({
                author: { pid: authorPID, name: localNames[0] || authorPID },
                records,
            });
            return;
        }
        res.json({ dblpperson: { $: { name: localNames[0] || authorPID } } });
    } catch (error) {
        console.log('Error during author computation', error);
        res.status(400).json({ error: error.message })
    }
}

// pid + ORCID (see dblpLocal.getAuthorOrcid) for a dblp author, mirroring
// hal.js's controllerAuthorInfo/getAuthorInfo -- kept as its own endpoint
// rather than folded into controllerAuthor above so that one's response
// shape (deliberately mimicking dblp.org's old live XML-derived shape,
// see its own comment) doesn't have to change for every existing caller.
export async function controllerAuthorInfo(req, res) {
    const pid = req.params[0];
    try {
        const orcid = await dblpLocal.getAuthorOrcid(pid);
        res.json({ pid, orcid: orcid ? `https://orcid.org/${orcid}` : null });
    } catch (error) {
        console.log('Error during author-info computation', error);
        res.status(400).json({ error: error.message });
    }
}

const searchLocalAuthors = createDblpSearch({
    getStatus: () => admin.getDblpStatus(),
    search: query => dblpLocal.searchAuthorsByName(query),
    tokenize: dblpLocal.tokenizeName,
    cache,
});

export async function controllerSearch(req, res) {
    const searchQuery = req.params[0];
    try {
        const author = await searchLocalAuthors(searchQuery);
        res.json(author);
    } catch (error) {
        console.log('Error during search computation', error);
        res.status(error.status || 400).json({ error: error.message })
    }
}
