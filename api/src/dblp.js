import * as cache from './cache.js';
import * as dblpLocal from './dblpLocal.js';
import * as admin from './admin.js';
import { createDblpSearch } from './dblpSearchCache.js';

export async function controllerAuthor(req, res) {
    const authorPID = req.params[0];
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
        res.json({ dblpperson: { $: { name: localNames[0] || authorPID } } });
    } catch (error) {
        console.log('Error during author computation', error);
        res.status(400).json({ error: error.message })
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
