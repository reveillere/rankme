import * as admin from './admin.js';
import * as cache from './cache.js';
import * as dblpLocal from './dblpLocal.js';
import * as hal from './hal.js';
import { extractDoi } from './crossref.js';
import { levenshtein } from './levenshtein.js';
import { computeDblpPublicationRank, computeHalPublicationRank, confSourceFrom, journalSourceFrom } from './authorStream.js';
import { parseIdentityLinks, assertIdentityPairIsCompatible, IdentityLinksConflictError } from './identityLinksInput.js';
import { crossCheckPresentationOptionsFrom, filterResultsByYear, applyCorrectionsToResults, renderCrossCheckExport } from './crosscheckPresentation.js';

// ****************************************************************************************************
// ****************************************************************************************************
// Author-scope, DBLP -> HAL crosscheck: for a given DBLP author (pid) and
// HAL identity (halId), lists which DBLP publications have no corresponding
// HAL deposit. Deliberately NOT levenshtein.js's own normalizeTitle -- that
// one strips numbers and a fixed stopword list tuned for matching *venue*
// names against CORE/SJR/CCF portals (see its own header comment), which
// would destroy real signal in a *paper title* (numbers in a title are
// often meaningful, e.g. "Byzantine Fault Tolerance in the Age of X").
export function normalizePubTitle(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        // HAL keeps accents as typed by the depositor; DBLP sometimes
        // transliterates them away (e.g. "Réveillère" -> "Reveillere") --
        // NFD-decomposing and dropping the combining-diacritic range lines
        // the two up regardless of which side kept them.
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// dblp's own <ee> element(s) can carry an arXiv link/id alongside (or
// instead of) a DOI -- in either the current "https://arxiv.org/abs/<id>"
// form or the older "arXiv:<archive>/<id>" form some pre-2007 records still
// use (e.g. "arXiv:hep-th/9901001"). Mirrors crossref.js's extractDoi in
// shape (ee can be a string or an array -- see admin.js's wireRecordParser).
const ARXIV_ABS_URL = /^https?:\/\/arxiv\.org\/abs\/(.+)$/i;
const ARXIV_PREFIXED = /^arxiv:(.+)$/i;

// A version suffix (e.g. "v2") identifies a *revision* of the same arXiv
// preprint, not a different paper -- HAL and dblp very often disagree on
// which version they point to, so it's stripped before comparing either
// side's id.
function normalizeArxivId(id) {
    return id ? id.replace(/v\d+$/i, '').toLowerCase() : null;
}

function extractArxivId(ee) {
    const urls = Array.isArray(ee) ? ee : (ee ? [ee] : []);
    for (const url of urls) {
        const match = ARXIV_ABS_URL.exec(url) || ARXIV_PREFIXED.exec(url);
        if (match) return normalizeArxivId(match[1]);
    }
    return null;
}

// Resolves pid -> name variants -> publications, using the same local dump
// dblpLocal.js already maintains for the DBLP tab. skipCoAuthorResolution:
// true -- crosscheck never renders co-author links, so paying for
// resolveAuthorPids' ~0.9s fan-out over the www collection here would be
// pure waste (see dblpLocal.js). Returns null (not []) when the pid itself
// is unknown -- see dblpLocal.getAuthorNames -- so the controller can 404
// instead of reporting an author with zero publications.
export async function getDblpPublicationsForCrosscheck(pid) {
    const names = await dblpLocal.getAuthorNames(pid);
    if (names === null) return null;
    return dblpLocal.getPublicationsByNames(names, { skipCoAuthorResolution: true });
}

// Confidence ordering used both to decide a dblp pub's overall status and,
// defensively, to dedupe a hal pub that somehow got recorded twice against
// the same dblp pub (shouldn't happen given the per-pair skips below, but
// cheap to guard against).
const CONFIDENCE_RANK = { exact: 3, strong: 2, fuzzy: 1 };

function dedupeMatchesByHalDocid(matches) {
    const byDocid = new Map();
    for (const match of matches) {
        const existing = byDocid.get(match.halPub.docid);
        if (!existing || CONFIDENCE_RANK[match.confidence] > CONFIDENCE_RANK[existing.confidence]) {
            byDocid.set(match.halPub.docid, match);
        }
    }
    return [...byDocid.values()];
}

// A token appearing in this many distinct dblp titles or more carries no
// discriminating power for the fuzzy-matching blocking step below (see
// step c) -- e.g. "towards", "approach", "networks" -- so it's never used
// to fetch fuzzy candidates, even though it's still present in the index.
const STOPWORD_TITLE_COUNT_CUTOFF = 200;
const FUZZY_CANDIDATE_CAP = 5;

// One-time inverted index over every dblp normalized title, built once per
// matchPublications call and then queried per hal pub (see
// selectFuzzyCandidates) instead of ever scanning the full dblp list again.
function buildFuzzyBlockingIndex(dblpNormTitles) {
    const distinctTitlesByToken = new Map(); // token -> Set of distinct dblp normalized titles containing it
    const dblpIndicesByToken = new Map(); // token -> Set of dblp pub indices containing it
    dblpNormTitles.forEach((title, i) => {
        if (!title) return;
        for (const token of new Set(title.split(' ').filter(Boolean))) {
            if (!distinctTitlesByToken.has(token)) distinctTitlesByToken.set(token, new Set());
            distinctTitlesByToken.get(token).add(title);
            if (!dblpIndicesByToken.has(token)) dblpIndicesByToken.set(token, new Set());
            dblpIndicesByToken.get(token).add(i);
        }
    });
    return { distinctTitlesByToken, dblpIndicesByToken };
}

// Exported so a test can prove blocking actually narrows the field, without
// needing to spy on the levenshtein import itself (ES module exports are
// live bindings, not writable properties, so mocking them cleanly isn't
// possible here): given the index above and one (already normalized) hal
// title, returns the bounded list of dblp-pub indices worth comparing via
// levenshtein at all -- its own rarest-two-usable-tokens intersection,
// capped at FUZZY_CANDIDATE_CAP, with stopword-cutoff tokens excluded from
// being used to look anything up. A hal title sharing nothing but
// stopword-cutoff tokens with any dblp title yields no candidates.
export function selectFuzzyCandidates({ distinctTitlesByToken, dblpIndicesByToken }, halNormTitle) {
    const halTokens = [...new Set(halNormTitle.split(' ').filter(Boolean))];
    // A token absent from any dblp title (typo, or simply a word the hal
    // title alone uses) has a candidate-list length of 0 -- the smallest
    // possible -- which would otherwise make it look like the *rarest*,
    // best token to pick, when it's actually the least useful one: picking
    // it poisons the intersection below to empty even when a genuine shared
    // rare token exists among the hal title's other words. "Usable" means
    // actually present in the dblp index (some real candidates) AND not
    // over the stopword cutoff.
    const isUsableToken = token => dblpIndicesByToken.has(token) && distinctTitlesByToken.get(token).size <= STOPWORD_TITLE_COUNT_CUTOFF;
    const chosenTokens = halTokens
        .filter(isUsableToken)
        .sort((a, b) => (dblpIndicesByToken.get(a)?.size || 0) - (dblpIndicesByToken.get(b)?.size || 0))
        .slice(0, 2);
    if (chosenTokens.length === 0) return [];

    const candidateIndices = chosenTokens.length === 1
        ? (dblpIndicesByToken.get(chosenTokens[0]) || new Set())
        : new Set([...(dblpIndicesByToken.get(chosenTokens[0]) || [])].filter(i => (dblpIndicesByToken.get(chosenTokens[1]) || new Set()).has(i)));
    return [...candidateIndices].slice(0, FUZZY_CANDIDATE_CAP);
}

// Multi-to-multi by design: a dblp pub (e.g. a CoRR preprint and its later
// conference version, two separate dblp records) can both legitimately
// match the same hal deposit, and a hal deposit can match several dblp
// records -- this never forces a bijection between the two sides.
//
// Three levels, checked in order, PER PAIR (a given dblp/hal pair can only
// be recorded once, at the highest level it qualifies for; a dblp pub can
// still be exact-matched to one hal pub and strong/fuzzy-matched to a
// different one):
//   a) exact  -- shared DOI or arXiv id
//   b) strong -- identical normalized title, year within +/-1
//   c) fuzzy  -- blocked levenshtein over normalized titles (see below)
export function matchPublications(dblpPubs, halPubs) {
    const results = dblpPubs.map(pub => ({ publication: pub, matches: [] }));

    // Pair already recorded at some level -- checked before adding a lower-
    // confidence match for the same pair, and defensively before adding a
    // fuzzy one (the eligibility filter in step c should already exclude
    // these, but this is cheap insurance against that filter's own bugs).
    const recordedPairs = new Set();
    const pairKey = (dblpIndex, halDocid) => `${dblpIndex}:${halDocid}`;

    // A hal pub already exact/strong-matched to ANY dblp pub is not a
    // fuzzy-matching candidate for a different one -- see step c's
    // eligibility rule.
    const halDocidsMatchedExactOrStrong = new Set();

    function record(dblpIndex, halPub, confidence, distance) {
        const key = pairKey(dblpIndex, halPub.docid);
        if (recordedPairs.has(key)) return;
        recordedPairs.add(key);
        const match = { halPub, confidence };
        if (distance !== undefined) match.distance = distance;
        results[dblpIndex].matches.push(match);
        if (confidence === 'exact' || confidence === 'strong') halDocidsMatchedExactOrStrong.add(halPub.docid);
    }

    // --- a) Exact: shared DOI or arXiv id -----------------------------
    // One map mixing both kinds of keys -- cheap, and there's no reason to
    // keep DOI and arXiv lookups in two separate maps.
    const halPubsByKey = new Map();
    const addKey = (key, halPub) => {
        if (!key) return;
        if (!halPubsByKey.has(key)) halPubsByKey.set(key, []);
        halPubsByKey.get(key).push(halPub);
    };
    for (const halPub of halPubs) {
        if (halPub.doi) addKey(`doi:${halPub.doi.toLowerCase()}`, halPub);
        if (halPub.arxivId) addKey(`arxiv:${normalizeArxivId(halPub.arxivId)}`, halPub);
    }

    dblpPubs.forEach((pub, i) => {
        const keys = [];
        const doi = extractDoi(pub.dblp.ee);
        if (doi) keys.push(`doi:${doi.toLowerCase()}`);
        const arxivId = extractArxivId(pub.dblp.ee);
        if (arxivId) keys.push(`arxiv:${arxivId}`);

        const seenDocids = new Set();
        for (const key of keys) {
            for (const halPub of halPubsByKey.get(key) || []) {
                if (seenDocids.has(halPub.docid)) continue;
                seenDocids.add(halPub.docid);
                record(i, halPub, 'exact');
            }
        }
    });

    // --- b) Strong: identical normalized title, year within +/-1 -----
    const halPubsByTitle = new Map();
    for (const halPub of halPubs) {
        const title = normalizePubTitle(halPub.title);
        if (!title) continue;
        if (!halPubsByTitle.has(title)) halPubsByTitle.set(title, []);
        halPubsByTitle.get(title).push(halPub);
    }

    const dblpNormTitles = dblpPubs.map(pub => normalizePubTitle(pub.dblp.title));

    dblpPubs.forEach((pub, i) => {
        const title = dblpNormTitles[i];
        if (!title) return;
        const dblpYear = parseInt(pub.dblp.year, 10);
        for (const halPub of halPubsByTitle.get(title) || []) {
            const halYear = parseInt(halPub.year, 10);
            if (Number.isNaN(dblpYear) || Number.isNaN(halYear) || Math.abs(halYear - dblpYear) > 1) continue;
            record(i, halPub, 'strong');
        }
    });

    // --- c) Fuzzy, with mandatory blocking -----------------------------
    // Never compare all-dblp x all-hal naively (a prolific author can have
    // hundreds of dblp records): build a token -> dblp-pub-indices index
    // once, then for each still-unmatched hal pub, fetch candidates via its
    // own rarest tokens instead of scanning every dblp pub.
    const fuzzyIndex = buildFuzzyBlockingIndex(dblpNormTitles);

    for (const halPub of halPubs) {
        if (halDocidsMatchedExactOrStrong.has(halPub.docid)) continue; // step c's eligibility rule

        const halTitle = normalizePubTitle(halPub.title);
        if (!halTitle) continue;

        const candidates = selectFuzzyCandidates(fuzzyIndex, halTitle);
        for (const i of candidates) {
            if (recordedPairs.has(pairKey(i, halPub.docid))) continue; // defensive, see record()
            const dblpTitle = dblpNormTitles[i];
            const threshold = Math.max(3, Math.round(0.1 * dblpTitle.length));
            // Short-circuit before the O(n*m) levenshtein call itself --
            // a length gap already past the threshold can never come back
            // under it.
            if (Math.abs(dblpTitle.length - halTitle.length) > threshold) continue;
            const distance = levenshtein(dblpTitle, halTitle);
            if (distance <= threshold) record(i, halPub, 'fuzzy', distance);
        }
    }

    return results.map(({ publication, matches }) => {
        const deduped = dedupeMatchesByHalDocid(matches);
        return { publication, status: statusFromMatches(deduped), matches: deduped };
    });
}

// Automatic match confidence. The browser applies personal decisions using
// this same rule; crosscheck.test.js also exercises that browser implementation.
function statusFromMatches(matches) {
    return matches.length === 0
        ? 'missing'
        : matches.some(m => m.confidence === 'exact' || m.confidence === 'strong') ? 'confirmed' : 'to-review';
}

// ****************************************************************************************************
// ****************************************************************************************************

const CACHE_TTL_S = 60 * 60; // 1h -- short-lived on purpose: this recomputes off two already-cached
                              // sources (dblpLocal's own Mongo query, hal.js's 1-day author cache), so
                              // there's no expensive re-fetch being saved, just the matching work itself.

// A rank is only worth computing for a publication CrossCheck.js actually
// renders one for -- a 'confirmed' pub is folded into a plain count on the
// front end (see CrossCheck.js), so ranking it here would be pure waste.
// Also skips anything other than inproceedings/article, same as
// authorStream.js's own isRankable filter (streamRankedItems) -- CORE/SJR/
// CCF have nothing to say about a book, proceedings volume, or informal
// entry either.
function needsRank(result) {
    return (result.status === 'missing' || result.status === 'to-review')
        && (result.publication.type === 'inproceedings' || result.publication.type === 'article');
}

// Every distinct HAL candidate appearing in a 'to-review' match, deduped by
// docid -- the same halPub object is already shared by reference across
// every match that points to it (matchPublications never clones a halPub),
// so ranking it once here and attaching `rank` to that shared object is
// enough for every match referencing it to pick it up.
function toReviewHalPubsByDocid(results) {
    const byDocid = new Map();
    for (const result of results) {
        if (result.status !== 'to-review') continue;
        for (const match of result.matches) {
            if (!byDocid.has(match.halPub.docid)) byDocid.set(match.halPub.docid, match.halPub);
        }
    }
    return byDocid;
}

// Returns null (not a report) when the pid itself is unknown, so the
// controller can 404 instead of caching/serving an empty-looking report.
export async function getCrossCheckReport(pid, halId, { confSource, journalSource }) {
    const dblpStatus = await admin.getDblpStatus();
    // Keyed on the dblp dump's own version (its MD5) and the ranking source
    // alongside pid/halId -- a re-import changes what "missing from HAL"
    // means for this author, and switching CORE/SJR<->CCF on either axis
    // changes what rank each still-missing/to-review publication gets, so a
    // cached report must not survive either. Overrides are deliberately NOT
    // part of this key: they are applied only in the browser.
    const key = `crosscheck:${pid}:${halId}:${dblpStatus.version}:${confSource}:${journalSource}`;

    let report = await cache.get(key);
    if (report === null) {
        const dblpPubs = await getDblpPublicationsForCrosscheck(pid);
        if (dblpPubs === null) return null;

        const halPubs = await hal.getAuthorPublications(halId);
        const results = matchPublications(dblpPubs, halPubs);

        // RankBadge (front/src/component/RankBadge.js) needs a `rank` to show
        // anything at all -- computed here, per publication, with the exact
        // same CORE/SJR/CCF logic controllerDblpAuthor streams for the plain
        // DBLP author page (see computeDblpPublicationRank in authorStream.js).
        // No SSE/concurrency limiter here: this endpoint stays a one-shot JSON
        // response, and a cross-check's own "missing"/"to-review" list is at
        // most a few dozen items -- nowhere near the thousands a big author/
        // team page's stream has to stay responsive under, so a plain
        // sequential pass is enough.
        for (const result of results) {
            if (!needsRank(result)) continue;
            try {
                const { rank, fullName } = await computeDblpPublicationRank(result.publication, { confSource, journalSource });
                result.publication.rank = rank;
                if (fullName) result.publication.fullName = fullName;
            } catch (error) {
                console.log('Error ranking crosscheck publication', result.publication.dblp?.key, error);
            }
        }

        // CrossCheck.js now renders each 'to-review' HAL candidate as a full
        // publication row (HalPublicationRow), which needs a `rank` too --
        // same computeHalPublicationRank logic authorStream.js's own HAL
        // author/structure streams use, just called directly per candidate
        // (see its own comment for why no batch prefetch here).
        for (const halPub of toReviewHalPubsByDocid(results).values()) {
            try {
                const { rank } = await computeHalPublicationRank(halPub, { confSource, journalSource });
                halPub.rank = rank;
            } catch (error) {
                console.log('Error ranking crosscheck HAL candidate', halPub.docid, error);
            }
        }

        report = {
            dblpStatus: { version: dblpStatus.version, importedAt: dblpStatus.importedAt },
            halCacheNote: 'HAL data may be up to 24h stale',
            results,
        };
        await cache.set(key, report, CACHE_TTL_S);
    }

    // Personal decisions are applied in the browser, never read from Mongo.
    return report;
}

export async function controllerCrossCheck(req, res) {
    const pid = req.params[0] || req.body?.pid;
    const halId = req.query.halId || req.body?.halId;
    if (!halId) {
        res.status(400).json({ error: 'halId query parameter is required' });
        return;
    }
    const confSource = confSourceFrom(req);
    const journalSource = journalSourceFrom(req);
    try {
        const identityLinks = parseIdentityLinks(req.body?.identityLinks ?? req.query.identityLinks);
        assertIdentityPairIsCompatible(identityLinks, { idHal: halId, pid });
        const report = await getCrossCheckReport(pid, halId, { confSource, journalSource });
        if (report === null) {
            res.status(404).json({ error: 'Not Found', message: `No DBLP author with pid ${pid}` });
            return;
        }
        // POST-only, same as dblp.controllerAuthor's own branch: the GET
        // compat route above is what CrossCheck.js itself uses, and it
        // already does this exact filtering/correction work client-side
        // (its own hasYearRange/effectiveValueAccessor-equivalent) -- redoing
        // it server-side there too would be redundant work on every page
        // load, not just a behavior change.
        if (req.method === 'POST') {
            const options = crossCheckPresentationOptionsFrom(req);
            const filtered = filterResultsByYear(report.results, options);
            const corrected = await applyCorrectionsToResults(filtered, options);
            if (options.export) {
                const { contentType, body } = renderCrossCheckExport(options.export, corrected, `DBLP → HAL cross-check for ${pid}`);
                res.set('Content-Type', contentType).send(body);
                return;
            }
            res.json({ ...report, results: corrected });
            return;
        }
        res.json(report);
    } catch (error) {
        console.log('Error during cross-check computation', error);
        res.status(error instanceof IdentityLinksConflictError ? 409 : 400).json({ error: error.message });
    }
}
