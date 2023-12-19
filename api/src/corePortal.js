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

async function getSources() {
  if (sources == null) {
    sources = await fetchSources();
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
    // await mkdir('/data/core', { recursive: true });

    sources = await fetchSources();
    let storedSources = await readJSON(SOURCES);
    if (JSON.stringify(sources) === JSON.stringify(storedSources)) {
      console.log('[core] No update needed');
    } else {
      console.log('[core] Updating sources ...');
      await writeFile(SOURCES, JSON.stringify(sources), 'utf-8');
      for (const source of sources) {
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

async function getRank(acronym, ref, year) {
  const key = `rank:${year}:${ref}`;

  let rank = await cache.get(key);
  if (rank === null) {
    const venueFullName = await getVenueFullName(ref);
    rank = await computeRank(acronym.toUpperCase(), venueFullName, year);
    cache.set(key, rank);
  }
  return rank;
}

async function computeRank(acronym, venueFullName, year) {
  const titleNormalized = normalizeTitle(venueFullName);
  const sources = await getSources();
  const sortedList = sources.sort((a, b) => b.year - a.year);
  const foundItem = sortedList.find(item => item.year <= year);
  const sourceKey = foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
  const source = await getSource(sourceKey);
  
  const candidates = source.filter(conf => conf.acronym === acronym);
  const sanitizedRank = (rank, exact, score) => RANKS.includes(rank) ?
    { value: rank, msg: `${sourceKey}`, exact: exact, score: score } :
    { value: "Misc", msg: `Ranked as ${rank} in ${sourceKey}`, exact: exact, score: score };

  let rank;

  if (candidates.length === 0) {
    const exactMatch = source.find(conf => levenshtein(normalizeTitle(conf.title), titleNormalized) === 0);

    if (exactMatch) {
      rank = sanitizedRank(exactMatch.rank, false, 0);
    } else {
      rank = { value: "Unranked", msg: `No ranking found in ${sourceKey}` };
    }
  } else if (candidates.length > 1) {
    let scores = candidates.map(conf => ({ conf: conf, score: levenshtein(normalizeTitle(conf.title), titleNormalized) }));
    let bestMatch = scores.reduce((min, current) => current.score < min.score ? current : min, scores[0]);
    rank = sanitizedRank(bestMatch.conf.rank, false, bestMatch.score);
  } else {
    const entry = candidates[0];
    const score = levenshtein(normalizeTitle(entry.title), titleNormalized);
    rank = sanitizedRank(entry.rank, true, score);
  }
  return rank;
}
