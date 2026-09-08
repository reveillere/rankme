import { getFetchAuthor, normalizePublications, getVenueFullName } from './dblp.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import { getAuthorPublications, getStructurePublications } from './hal.js';
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

// Shared by both HAL entry points below: an author's and a structure's
// publications are the exact same shape (HAL doesn't distinguish), so the
// matching/ranking logic that turns a venue string into a CORE/SJR rank is
// identical either way -- only which publication list gets fetched differs.
async function rankHalPublications(res, publications, label) {
    await streamRankedItems(
        res, publications,
        pub => pub.type === 'COMM' || pub.type === 'ART',
        async (pub) => {
            // HAL's own venue field is free text typed by the depositor
            // at submission time, but very often already carries its own
            // acronym -- trailing, e.g. "... (DAIS)", or leading, e.g.
            // "ASE18 - Proceedings of..." -- which is free to extract
            // and, paired with the venue text it came from, is an
            // internally consistent source for acronym-first CORE
            // matching. Crossref (when a DOI is available) can offer a
            // cleaner acronym HAL doesn't expose at all; when it does,
            // its acronym and full name are used as a pair too, since
            // for some records (Springer/LNCS proceedings especially)
            // Crossref's full name alone collapses to a single generic
            // word ("Middleware 2012") that coincidentally fuzzy-matches
            // unrelated CORE entries once stripped of its own acronym.
            // A "... colocated with ..." suffix describes a *different*
            // (host) venue -- stripped before any matching so its title
            // never gets fuzzy-matched as if it were this record's own.
            let venue = crossref.stripColocationSuffix(pub.venue);
            const wasColocated = venue !== pub.venue;
            let acronym = crossref.extractTrailingAcronym(venue) || crossref.extractLeadingAcronym(venue);
            // Skip the Crossref lookup entirely when HAL's own text says
            // this was co-located: IEEE/ACM often file a co-located
            // workshop's papers under the *host* conference's DOI
            // container (see e.g. 10.1109/CISIS.2010.167, whose Crossref
            // record only ever mentions "CISIS", never the workshop it
            // was actually published as -- "IMIS"), so Crossref can't be
            // trusted to know this record's own venue any better than
            // HAL's colocation-suffix text already told us it can't.
            if (pub.doi && !wasColocated) {
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
        label
    );
}

export async function controllerHalAuthor(req, res) {
    const id = req.params[0];
    try {
        const publications = await getAuthorPublications(id);
        await rankHalPublications(res, publications, `hal:${id}`);
    } catch (error) {
        console.error('[authorStream] hal error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}

export async function controllerHalStructure(req, res) {
    const id = req.params[0];
    try {
        const publications = await getStructurePublications(id);
        await rankHalPublications(res, publications, `hal-structure:${id}`);
    } catch (error) {
        console.error('[authorStream] hal structure error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}
