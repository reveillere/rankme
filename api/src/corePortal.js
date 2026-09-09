import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';
import { normalizeTitle, levenshtein } from './levenshtein.js';
import * as cache from './cache.js'
import { getVenueFullName } from './dblp.js';
import { writeFile, readFile, mkdir } from 'fs/promises';

export const BASE = 'http://portal.core.edu.au/conf-ranks';
export const querySource = '?search=&by=all&do=Export&source=';

const RANKS = ['A*', 'A', 'B', 'C'];

import fetch from './throttler.js';

let sources = null;

// Falls back to the on-disk snapshot (see SOURCES below, written by load())
// when portal.core.edu.au can't be reached -- mirrors the same
// local-first-with-network-fallback pattern already used for the DBLP dump
// (admin.js) and SJR data (sjrPortal.js's loadYearCSV), so a get*Rank* call
// mid-request doesn't retry a live fetch (and its full request timeout) on
// every single publication when the site is down/blocked, only once at
// startup (see load()) with this as the safety net for whenever that
// startup check itself failed.
async function getSources() {
  if (sources == null) {
    try {
      sources = await fetchSources();
    } catch (error) {
      console.log(`[core] Could not reach portal.core.edu.au (${error.message}), falling back to the local snapshot.`);
      sources = await readJSON(SOURCES);
      if (sources == null) throw error; // nothing to fall back to
    }
  }
  return sources;
}

async function fetchSources() {
  const resp = await fetch(BASE);
  const html = await resp.text();
  const dom = HTMLParser.parse(html);
  const options = dom.querySelectorAll('select[name=source] option').map(o => o.rawText);
  const yearRegex = /\d+/g;
  let sources = [];
  options.forEach(item => {
    const trimmedItem = item.trim();
    if (trimmedItem === 'All') return;
    const matches = trimmedItem.match(yearRegex) || [];
    matches.forEach(match => {
      if (match.length === 4) {
        sources.push({
          year: parseInt(match, 10),
          source: trimmedItem
        });
      }
    });
  });
  return sources;
}


async function readJSON(path) {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`[core] Error reading JSON file : ${path}`, error);
    return null;
  }
}

// Returns the list of availables sources on Core Portal
export async function controllerSources(req, res) {
  try {
    const sources = await getSources();
    res.json(sources);
  } catch (e) {
    console.error('[core] Error fetching sources: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
}


// Returns the source  for a given source
async function getSource(id) {
  const key = `core:source:${id}`;
  let source = await cache.get(key);
  if (source) {
    return source;
  }
  console.log(`[core] Source ${id} not in cache, reading from file ...`)
  source = await readJSON(SOURCE(id));
  await cache.set(key, source);
  return source;
}

async function fetchSource(id) {
  const url = `${BASE}/?search=&by=all&do=Export&source=${id}`;
  const resp = await fetch(url);
  const text = await resp.text();
  const data = await parseRankSource(text);
  return data;
}

const SOURCES = '/data/core/sources.json';
const SOURCE = (id) => `/data/core/source_${id}.json`;


export async function load() {
  try {
    console.log('[core] Loading sources ...');
    await mkdir('/data/core', { recursive: true });

    let liveSources = null;
    try {
      liveSources = await fetchSources();
    } catch (error) {
      console.log(`[core] Could not check portal.core.edu.au for updated sources (${error.message}), using the local snapshot if any.`);
    }
    const storedSources = await readJSON(SOURCES);

    if (liveSources == null) {
      // Network check failed outright -- getSources() falls back to the
      // same on-disk snapshot on demand, so nothing more to do here.
      sources = storedSources;
      console.log(storedSources ? '[core] Using local snapshot.' : '[core] No local snapshot and network check failed -- CORE ranking will be empty until either is available.');
    } else if (JSON.stringify(liveSources) === JSON.stringify(storedSources)) {
      sources = liveSources;
      console.log('[core] No update needed');
    } else {
      sources = liveSources;
      console.log('[core] Updating sources ...');
      await writeFile(SOURCES, JSON.stringify(liveSources), 'utf-8');
      for (const source of liveSources) {
        const data = await fetchSource(source.source);
        await writeFile(SOURCE(source.source), JSON.stringify(data), 'utf-8');
      }
      console.log('[core] Sources loaded');
    }

  } catch (error) {
    console.error('[core] Error loading sources', error);
  }
}

export async function controllerSource(req, res) {
  try {
    const { id } = req.params;
    const sources = await getSources();
    if (!sources.some(item => item.source === id)) {
      res.status(404).json({ error: `Source ${id} not found in availables sources!` });
      return;
    }
    const source = await getSource(id);
    res.json(source);
  } catch (e) {
    console.error('[core] Error fetching source: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
}




// ************************************************************************************
// ************************************************************************************



// Ranking
async function parseRankSource(txt) {
  try {
    const headers = ['id', 'title', 'acronym', 'source', 'rank', 'm1', 'm2', 'm3', 'm4'];
    const results = await Papa.parse(txt, {
      header: true,
      beforeFirstChunk: function (chunk) {
        const rows = chunk.split(/\r\n|\r|\n/);
        rows.unshift(headers.join());
        return rows.join('\r\n');
      }
    });

    return results.data.map(item => ({
      id: item.id,
      title: item.title,
      acronym: ("" + item.acronym).toUpperCase(),
      rank: item.rank
    })).filter(item => item.id !== "");
  } catch (e) {
    console.error('[core] Fetch Error: ', e);
    throw e;
  }
}


export async function controllerRank(req, res) {
  const ref = 'db/conf/' + req.params[0];
  const year = req.query.year;
  const acronym = req.query.acronym;

  if (!year || !acronym) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters' });
    return;
  }

  try {
    const rank = await getRank(acronym.toUpperCase(), ref, year);
    res.json(rank);
  } catch (error) {
    console.error('[core] Error during rank computation', error);
    res.status(400).json({ error: 'Internal Server Error', message: error.message });
  }
}

export async function getRank(acronym, ref, year) {
  const key = `rank:${year}:${ref}`;

  let rank = await cache.get(key);
  if (rank === null) {
    const venueFullName = await getVenueFullName(ref);
    rank = await computeRank(acronym.toUpperCase(), venueFullName, year);
    // TTL'd (not permanent): a transient miss — e.g. sources still being
    // (re)loaded by load() at startup — would otherwise get cached as
    // "no ranking found" forever.
    cache.set(key, rank, 60 * 60 * 24);
  }
  return rank;
}

// Both computeRank (acronym-first, dblp path) and computeRank2 (fuzzy-only,
// HAL path — no acronym available) need the same yearly source snapshot and
// the same rank-message shaping; only the actual matching strategy differs.
async function resolveSource(year) {
  const sources = await getSources();
  const sortedList = sources.sort((a, b) => b.year - a.year);
  const foundItem = sortedList.find(item => item.year <= year);
  const sourceKey = foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
  const source = await getSource(sourceKey);
  return { sourceKey, source };
}

// Structured result shape shared by every match branch below (and mirrored
// by sjrPortal.js) so the front end can build one consistent tooltip/edit UI
// for both CORE and SJR instead of parsing a human-readable message string.
//   value:          the badge grade -- a RANKS entry, "Misc" (a real CORE
//                    rank string outside RANKS, e.g. "Multiconference"), or
//                    "Unranked"
//   rawValue:        the original CORE rank string when value is "Misc"
//   matchType:       'exact' | 'fuzzy' | 'ambiguous' | 'none'
//   matchedTitle/Acronym/Id: identifies which CORE entry was matched, so a
//                    user can review or override it
//   distance:        word-level edit distance between the venue and the
//                    matched title (informational only when matchType is
//                    'exact', since that's already guaranteed correct by a
//                    unique acronym or a literal title match)
//   currentSource/currentValue: the SAME CORE entry's rank in the latest
//                    available edition, when it differs from the one used
//                    (rankings drift between editions)
function makeSanitizedRank(sourceKey) {
  return (entry, matchType, distance) => {
    const isStandard = RANKS.includes(entry.rank);
    return {
      value: isStandard ? entry.rank : (entry.rank ? 'Misc' : 'Unranked'),
      rawValue: isStandard ? null : (entry.rank || null),
      source: sourceKey,
      matchType,
      matchedTitle: entry.title,
      matchedAcronym: entry.acronym,
      matchedId: entry.id,
      distance,
    };
  };
}

function unrankedResult(sourceKey) {
  return { value: 'Unranked', rawValue: null, source: sourceKey, matchType: 'none', matchedTitle: null, matchedAcronym: null, matchedId: null, distance: null };
}

function ambiguousResult(sourceKey, tied) {
  return {
    value: 'Unranked', rawValue: null, source: sourceKey, matchType: 'ambiguous',
    matchedTitle: null, matchedAcronym: null, matchedId: null, distance: null,
    ambiguousWith: tied.map(t => ({ title: t.conf.title, acronym: t.conf.acronym, id: t.conf.id, value: t.conf.rank })),
  };
}

// Best-effort: looks up the same CORE entry (by its stable numeric id, which
// survives across yearly editions) in the most recent available edition, so
// the tooltip can show "this venue is now ranked X" alongside the rank that
// actually applied for the publication's own year. Silently gives up (the
// cached rank stays usable, just without this extra) if anything's missing.
// queryText is folded in here too (rather than at every call site) since
// every branch of computeRank/computeRank2 funnels through this on its way
// out -- it's what the front end needs, alongside matchedId, to key a
// user's override to this exact (source edition, input text) pair.
async function attachCurrentValue(rank, queryText) {
  rank = { ...rank, queryText };
  if (rank.matchedId == null) return rank;
  try {
    const sources = await getSources();
    const latest = sources.reduce((max, s) => (s.year > max.year ? s : max), sources[0]);
    if (!latest) return rank;
    // Already looking at the latest edition -- its rank IS the current one,
    // no extra lookup needed. Set unconditionally (not just when it turns
    // out to differ) so the front end can always show "current rank"
    // instead of only when there happens to be a discrepancy.
    if (latest.source === rank.source) {
      return { ...rank, currentSource: rank.source, currentValue: rank.value };
    }
    const latestSource = await getSource(latest.source);
    const latestEntry = latestSource.find(c => c.id === rank.matchedId);
    if (!latestEntry) return rank;
    return {
      ...rank,
      currentSource: latest.source,
      currentValue: RANKS.includes(latestEntry.rank) ? latestEntry.rank : (latestEntry.rank ? 'Misc' : 'Unranked'),
    };
  } catch (error) {
    console.error('[core] Error attaching current value', error);
    return rank;
  }
}

// Free-text search over one edition's CORE entries, for the "change match"
// picker: the user types a few characters, gets candidate titles/acronyms
// back to pick from instead of only ever seeing the one automatic match.
export async function controllerCandidates(req, res) {
  const year = Number(req.query.year);
  const q = (req.query.q || '').trim().toLowerCase();
  if (!year) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing year' });
    return;
  }
  try {
    const { sourceKey, source } = await resolveSource(year);
    const sources = await getSources();
    const latest = sources.reduce((max, s) => (s.year > max.year ? s : max), sources[0]);
    // Each result also carries the same entry's rank in the latest edition
    // -- CORE data is small and already in memory, so this is cheap even
    // for 50 results, and it's exactly what a user picking a match to
    // override with needs to see, same as the automatic match already gets.
    const latestById = latest && latest.source !== sourceKey
      ? new Map((await getSource(latest.source)).map(c => [c.id, c]))
      : null;
    const toRank = (rank) => RANKS.includes(rank) ? rank : (rank ? 'Misc' : 'Unranked');
    const results = q.length < 2 ? [] : source
      .filter(c => c.title.toLowerCase().includes(q) || c.acronym.toLowerCase().includes(q))
      .slice(0, 50)
      .map(c => {
        const latestEntry = latestById ? latestById.get(c.id) : (latest && latest.source === sourceKey ? c : null);
        return {
          id: c.id, title: c.title, acronym: c.acronym,
          value: toRank(c.rank), rawValue: RANKS.includes(c.rank) ? null : c.rank,
          currentSource: latest ? latest.source : null,
          currentValue: latestEntry ? toRank(latestEntry.rank) : null,
        };
      });
    res.json({ source: sourceKey, results });
  } catch (error) {
    console.error('[core] Error searching candidates', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}

async function computeRank(acronym, venueFullName, year) {
  const titleNormalized = normalizeTitle(venueFullName);
  const { sourceKey, source } = await resolveSource(year);
  const sanitizedRank = makeSanitizedRank(sourceKey);

  const candidates = source.filter(conf => conf.acronym === acronym);

  let rank;

  if (candidates.length === 0) {
    const exactMatch = source.find(conf => levenshtein(normalizeTitle(conf.title), titleNormalized) === 0);
    rank = exactMatch ? sanitizedRank(exactMatch, 'exact', 0) : unrankedResult(sourceKey);
  } else if (candidates.length > 1) {
    let scores = candidates.map(conf => ({ conf: conf, score: levenshtein(normalizeTitle(conf.title), titleNormalized) }));
    const minScore = Math.min(...scores.map(s => s.score));
    const tied = scores.filter(s => s.score === minScore);
    // Several same-acronym CORE entries are equally close by title -- if
    // they don't even agree on the rank, picking one over the other would
    // be a coin flip, so say so instead of silently trusting whichever
    // happened to sort first.
    if (tied.length > 1 && new Set(tied.map(t => t.conf.rank)).size > 1) {
      rank = ambiguousResult(sourceKey, tied);
    } else {
      const bestMatch = tied[0];
      rank = sanitizedRank(bestMatch.conf, bestMatch.score === 0 ? 'exact' : 'fuzzy', bestMatch.score);
    }
  } else {
    // Unique acronym match -- always high confidence regardless of the
    // title score, which is only informational here.
    const entry = candidates[0];
    const score = levenshtein(normalizeTitle(entry.title), titleNormalized);
    rank = sanitizedRank(entry, 'exact', score);
  }
  return attachCurrentValue(rank, venueFullName);
}



// ************************************************************************************
// ************************************************************************************



export async function controllerRank2(req, res) {
  const { fullName, year } = req.body
  if (!year || !fullName) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters' });
    return;
  }

  try {
    const rank = await getRankByFullName(fullName, year);
    res.json(rank);
  } catch (error) {
    console.error('[core] Error during rank computation', error);
    res.status(400).json({ error: 'Internal Server Error', message: error.message });
  }
}

export async function getRankByFullName(fullName, year) {
  const key = `rank:${year}:core2:${fullName}`;

  let rank = await cache.get(key);
  if (rank === null) {
    rank = await computeRank2(fullName, year);
    cache.set(key, rank, 60 * 60 * 24);
  }
  return rank;
}

// Same acronym-first strategy as the DBLP path's getRank, but for callers
// (HAL, via Crossref) that already have an acronym and full name in hand
// instead of a dblp ref to resolve one from.
export async function getRankByAcronymAndFullName(acronym, fullName, year) {
  const key = `rank:${year}:core2acro:${acronym}:${fullName}`;

  let rank = await cache.get(key);
  if (rank === null) {
    rank = await computeRank(acronym.toUpperCase(), fullName, year);
    cache.set(key, rank, 60 * 60 * 24);
  }
  return rank;
}





async function computeRank2(venueFullName, year) {
  const titleNormalized = normalizeTitle(venueFullName);
  const { sourceKey, source } = await resolveSource(year);
  const sanitizedRank = makeSanitizedRank(sourceKey);

  let rank;

  // No acronym to anchor on here (HAL gave none, neither did Crossref), so
  // this is matching on title words alone against the *entire* ranking
  // database -- the riskiest path (see e.g. "IEEE Conference on Pervasive
  // Computing and Applications" coincidentally matching "... and
  // Communications" (PERCOM) at distance 2). Capped tighter than the
  // acronym-first path's implicit tolerance to cut down on that kind of
  // same-topic-different-conference false positive.
  const MAX_FUZZY_DISTANCE = 2;

  // This is WORD-level edit distance (each "character" is a whole word,
  // compared by exact equality), not textual similarity -- any single
  // unrelated word is a substitution (cost 1) away from any other, so a
  // short normalized query is trivially within MAX_FUZZY_DISTANCE of nearly
  // every CORE entry of similar length regardless of actual relatedness.
  // E.g. ['compas'] -> ['acmmm','multimedia'] is just "substitute compas
  // for acmmm, insert multimedia" = distance 2, no matter how unrelated
  // "Compas" and "ACM Multimedia" actually are. Scaling the allowed
  // distance to the query's own length (so a majority of its words must
  // genuinely line up) guards against this regardless of query length,
  // instead of only blocking the single-word extreme of it.
  if (titleNormalized.length < 2) {
    return { ...unrankedResult(sourceKey), queryText: venueFullName };
  }
  const maxAllowedDistance = Math.min(MAX_FUZZY_DISTANCE, Math.floor(titleNormalized.length / 2));
  const scores = source.map(conf => ({ conf: conf, levenshtein: levenshtein(normalizeTitle(conf.acronym + ' ' + conf.title), titleNormalized) }));
  const candidates = scores.filter(score => score.levenshtein <= maxAllowedDistance);

  if (candidates.length === 0) {
    rank = unrankedResult(sourceKey);
  } else {
    // print debug info for the first 5 candidates with the lowest levenshtein distance
    const sortedCandidates = candidates.sort((a, b) => a.levenshtein - b.levenshtein);
    console.log(`[ranking of ${venueFullName} => ${titleNormalized}] Found ${sortedCandidates.length} candidates in ${sourceKey}`);
    for (let i = 0; i < Math.min(10, sortedCandidates.length); i++) {
      console.log(`[ranking] ${i + 1}: ${sortedCandidates[i].conf.title} => ${normalizeTitle(sortedCandidates[i].conf.acronym + ' ' + sortedCandidates[i].conf.title)} (distance=${sortedCandidates[i].levenshtein})`);
    }

    const minDistance = sortedCandidates[0].levenshtein;
    const tied = sortedCandidates.filter(c => c.levenshtein === minDistance);
    // Same rationale as the acronym-tiebreak branch above: with no acronym
    // to anchor on, several unrelated CORE entries tying for closest match
    // is common (short/generic titles collide easily -- see MAX_FUZZY_DISTANCE's
    // comment). Only trust the pick when they agree on the rank.
    if (tied.length > 1 && new Set(tied.map(t => t.conf.rank)).size > 1) {
      rank = ambiguousResult(sourceKey, tied.map(t => ({ conf: t.conf })));
    } else {
      const bestMatch = tied[0];
      rank = sanitizedRank(bestMatch.conf, bestMatch.levenshtein === 0 ? 'exact' : 'fuzzy', bestMatch.levenshtein);
    }
  }
  return attachCurrentValue(rank, venueFullName);
}
