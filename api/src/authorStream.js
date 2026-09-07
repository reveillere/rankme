import { getFetchAuthor, normalizePublications, getVenueFullName } from './dblp.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import { getAuthorPublications } from './hal.js';
import * as crossref from './crossref.js';
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
            },
            `dblp:${pid}`
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
            async (pub) => {
                // HAL's own venue field is free text typed by the depositor
                // at submission time, but very often already ends with its
                // own "(ACRONYM)" -- e.g. "... (DAIS)" -- which is free to
                // extract and, paired with the venue text it came from, is
                // an internally consistent source for acronym-first CORE
                // matching. Crossref (when a DOI is available) can offer a
                // cleaner acronym HAL doesn't expose at all; when it does,
                // its acronym and full name are used as a pair too, since
                // for some records (Springer/LNCS proceedings especially)
                // Crossref's full name alone collapses to a single generic
                // word ("Middleware 2012") that coincidentally fuzzy-matches
                // unrelated CORE entries once stripped of its own acronym.
                let venue = pub.venue;
                let acronym = crossref.extractTrailingAcronym(pub.venue);
                if (pub.doi) {
                    const info = await crossref.getVenueInfo(pub.doi);
                    if (info?.acronym) {
                        venue = info.fullName || venue;
                        acronym = info.acronym;
                    }
                }

                const rank = pub.type === 'COMM'
                    ? (acronym
                        ? await core.getRankByAcronymAndFullName(acronym, venue, pub.year)
                        : await core.getRankByFullName(venue, pub.year))
                    : await sjr.getRankByFullName(venue, pub.year);
                return { rank };
            },
            `hal:${id}`
        );
    } catch (error) {
        console.error('[authorStream] hal error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}
