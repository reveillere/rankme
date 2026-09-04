import { getFetchAuthor, normalizePublications, getVenueFullName } from './dblp.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import { getAuthorPublications } from './hal.js';
import { streamRankedItems } from './ranking.js';

export async function controllerDblpAuthor(req, res) {
    const pid = req.params[0];
    try {
        const author = await getFetchAuthor(pid);
        const publications = normalizePublications(author);
        await streamRankedItems(
            res, publications,
            pub => pub.type === 'inproceedings' || pub.type === 'article',
            async (pub) => {
                const ref = pub.dblp.url.split('#')[0];
                const [fullName, rank] = await Promise.all([
                    getVenueFullName(ref),
                    pub.type === 'inproceedings'
                        ? core.getRank(pub.venue, ref, pub.dblp.year)
                        : sjr.getRank(ref, pub.dblp.year),
                ]);
                return { fullName, rank };
            }
        );
    } catch (error) {
        console.error('[authorStream] dblp error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}

export async function controllerHalAuthor(req, res) {
    const id = req.params[0];
    try {
        const publications = await getAuthorPublications(id);
        await streamRankedItems(
            res, publications,
            pub => pub.type === 'COMM' || pub.type === 'ART',
            async (pub) => ({
                rank: pub.type === 'COMM'
                    ? await core.getRankByFullName(pub.venue, pub.year)
                    : await sjr.getRankByFullName(pub.venue, pub.year),
            })
        );
    } catch (error) {
        console.error('[authorStream] hal error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}
