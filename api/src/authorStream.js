import { getFetchAuthor, normalizePublications, getVenueFullName } from './dblp.js';
import * as dblpLocal from './dblpLocal.js';
import * as admin from './admin.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import { getAuthorPublications, getStructurePublications } from './hal.js';
import * as crossref from './crossref.js';
import { streamRankedItems } from './ranking.js';

// dblp's own <booktitle> is very often *just* the acronym, optionally with
// a trailing year/edition ("PODC", "AINA 2017", "ICSE'22") -- neither of
// crossref.js's extractTrailingAcronym ("... (XYZ)") nor extractLeadingAcronym
// ("XYZ - ...") matches that shape, since both were tuned for HAL's own
// (differently formatted) venue text. Deliberately conservative: only
// fires when the *entire* string is just that (no other words), so a
// genuinely descriptive booktitle still falls through to fuzzy full-name
// matching instead of being misread as an acronym.
// Case is NOT required to already be upper (e.g. dblp's own booktitle for
// the Middleware conference is just "Middleware", not "MIDDLEWARE", yet
// CORE's own acronym field for it is "MIDDLEWARE") --
// core.getRankByAcronymAndFullName uppercases before comparing against
// CORE's acronym field (itself always stored upper, see parseRankSource),
// and when the word turns out not to be a real acronym after all,
// computeRank's own fallback (an exact title match) is no stricter than
// what a bare single word gets anyway from the no-acronym fuzzy path
// (computeRank2's distance tolerance scales down to 0 for a single-word
// query) -- so there is nothing to lose by trying it regardless of case.
function extractBareAcronym(text) {
    if (!text) return null;
    const match = text.match(/^([A-Za-z][A-Za-z0-9.\-]{1,15})(?:\s*'?\d{2,4})?$/);
    return match ? match[1] : null;
}

export async function controllerDblpAuthor(req, res) {
    const pid = req.params[0];
    try {
        // Local dump only for now -- dblp.org itself is behind Anubis
        // anti-bot protection (see throttler.js's dblp_scrape_limiter
        // comment), so the live path (fetchViaLiveDblp below) is
        // deliberately not called anymore, kept intact for a future
        // deployment where dblp.org isn't blocked rather than removed.
        const status = await admin.getDblpStatus();
        if (!status.ready) {
            res.status(503).json({ error: status.importing ? 'DBLP local dump import in progress' : 'DBLP local dump not imported yet' });
            return;
        }
        const localNames = await dblpLocal.getAuthorNames(pid);
        if (localNames == null) {
            res.status(404).json({ error: `No local DBLP record for PID ${pid}` });
            return;
        }
        const publications = await dblpLocal.getPublicationsByNames(localNames);
        await streamRankedItems(
            res, publications,
            pub => pub.type === 'inproceedings' || pub.type === 'article',
            async (pub) => {
                // Same acronym-first strategy as the HAL path below --
                // dblp's own <booktitle> text (e.g. "AINA 2017") often
                // already carries the acronym directly. No network
                // lookup: getRankByAcronymAndFullName/getRankByFullName
                // (unlike getRank in fetchViaLiveDblp) never call
                // getVenueFullName.
                const acronym = crossref.extractTrailingAcronym(pub.venue) || crossref.extractLeadingAcronym(pub.venue) || extractBareAcronym(pub.venue);
                let rank = pub.type === 'inproceedings'
                    ? (acronym
                        ? await core.getRankByAcronymAndFullName(acronym, pub.venue, pub.dblp.year)
                        : await core.getRankByFullName(pub.venue, pub.dblp.year))
                    : await sjr.getRankByFullName(pub.venue, pub.dblp.year);
                // dblp's own <booktitle>/<journal> text is sometimes too
                // abbreviated or informal to match well -- a journal name
                // like "Empir. Softw. Eng." never fuzzy-matches SJR's
                // "Empirical Software Engineering" at all, and even a
                // conference's booktitle occasionally yields only a fuzzy
                // or ambiguous CORE match. When the local attempt isn't
                // already an exact match and dblp's own DOI (<ee>) is
                // available, ask Crossref for the real title/acronym and
                // retry -- same fallback the HAL path already uses (see
                // rankHalPublications). Only adopted when it's clearly
                // better -- an authoritative exact match, or anything at
                // all when the local attempt had no single usable answer
                // ('none', or 'ambiguous': e.g. dblp's own booktitle was
                // just the bare acronym "SAC", shared by two unrelated
                // CORE entries -- ACM's own Symposium on Applied Computing
                // and Selected Areas in Cryptography -- with nothing to
                // break the tie; Crossref's fuller title clearly favors
                // one even at fuzzy confidence, which is still strictly
                // more useful than refusing to pick between two options
                // that don't even agree on a rank) -- not swapped in just
                // because it's a different guess than a *specific* one we
                // already had (rank.matchType === 'fuzzy' keeps the
                // original rather than trading one uncertain single guess
                // for another).
                // Crossref's fullName is also just a better venue name to
                // show a reader than dblp's own abbreviated <journal>
                // text (or, for a conference, whatever's in <booktitle>)
                // -- returned to Publications.js regardless of whether it
                // ended up changing the rank below.
                let fullName;
                if (rank.matchType !== 'exact') {
                    const doi = crossref.extractDoi(pub.dblp.ee);
                    if (doi) {
                        const info = await crossref.getVenueInfo(doi);
                        let doiRank = null;
                        if (pub.type === 'inproceedings' && (info?.acronym || info?.fullName)) {
                            doiRank = info.acronym
                                ? await core.getRankByAcronymAndFullName(info.acronym, info.fullName || pub.venue, pub.dblp.year)
                                : await core.getRankByFullName(info.fullName, pub.dblp.year);
                        } else if (pub.type === 'article' && info?.fullName) {
                            doiRank = await sjr.getRankByFullName(info.fullName, pub.dblp.year);
                        }
                        if (doiRank && (doiRank.matchType === 'exact' || rank.matchType === 'none' || rank.matchType === 'ambiguous')) {
                            rank = doiRank;
                        }
                        fullName = info?.fullName;
                    }
                }
                return { rank, fullName };
            },
            `dblp:${pid}`
        );
    } catch (error) {
        console.error('[authorStream] dblp error', error);
        if (!res.headersSent) res.status(400).json({ error: error.message }); else res.end();
    }
}

// Dormant: the live dblp.org path controllerDblpAuthor used before the
// local dump existed. Not called anymore (dblp.org is blocked by Anubis
// anti-bot protection in this environment) -- kept as-is, unplugged rather
// than deleted, for a future deployment where it isn't.
// eslint-disable-next-line no-unused-vars
async function fetchViaLiveDblp(req, res, pid) {
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
