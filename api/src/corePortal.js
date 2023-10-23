import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';
import { normalizeTitle, levenshtein } from './levenshtein.js';
import * as cache from './cache.js'

export const BASE = 'http://portal.core.edu.au/conf-ranks';
export const querySource = '?search=&by=all&do=Export&source=';

const RANKS = ['A*', 'A', 'B', 'C'];


import QueueThrottler from './throttler.js';
const throttler = new QueueThrottler();

async function getSources() {
  const key = 'core:sources';
  const sources = await cache.get(key);
  if (sources) {
    return sources;
  }

  // cache miss
  const resp = await throttler.fetch(BASE);
  const html = await resp.text();
  const dom = HTMLParser.parse(html);
  const options = dom.querySelectorAll('select[name=source] option').map(o => o.rawText);
  const yearRegex = /\d+/g;
  const data = [];
  options.forEach(item => {
    const trimmedItem = item.trim();
    if (trimmedItem === 'All') return;
    const matches = trimmedItem.match(yearRegex) || [];
    matches.forEach(match => {
      if (match.length === 4) {
        data.push({
          year: parseInt(match, 10),
          source: trimmedItem
        });
      }
    });
  });
  await cache.set(key, data);
  return data;
}

// Returns the list of availables sources on Core Portal
export async function controllerSources(req, res) {
  try {
    const sources = await getSources();
    res.json(sources);
  } catch (e) {
    console.error('Error fetching sources: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
}

 
// Returns the source  for a given source
async function getSource(id) {
  const url = `${BASE}/?search=&by=all&do=Export&source=${id}`;
  const key = `core:source:${id}`;
  const source = await cache.get(key);
  if (source) {
    return source;
  }
  const resp = await throttler.fetch(url);
  const text = await resp.text();
  const data = await parseRankSource(text);
  await cache.set(key, data);
  return data;
}


export async function load() {
  console.log('Loading core sources ...');
  const sources = await getSources();
  for (const source of sources) {
    console.log(`Fetching: ${source.source}`);
    await getSource(source.source);
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
    console.error('Error fetching source: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
}




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
    console.error('Fetch Error: ', e);
    throw e;
  }
}

export async function controllerRank(req, res) {
  const year = decodeURIComponent(req.query.year);
  const acronym = decodeURIComponent(req.query.acronym);
  const title = decodeURIComponent(req.query.title);

  if (!year || !acronym) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters year and/or acronym' });
    return;
  }

  const rank = await getRank(acronym.toUpperCase(), title, year);
  res.json(rank);
}



async function getRank(acronym, title, year) {
  const key = `core:rank:${acronym}:${title}:${year}`;

  let rank = await cache.get(key);
  if (rank) {
    return rank;
  }

  // cache miss
  const titleNormalized = normalizeTitle(title);
  const sources = await getSources();
  const sortedList = sources.sort((a, b) => b.year - a.year);
  const foundItem = sortedList.find(item => item.year <= year);
  const sourceKey = foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
  const source = await getSource(sourceKey);

  const candidates = source.filter(conf => conf.acronym === acronym);
  const sanitizedRank = (rank, exact, score) => RANKS.includes(rank) ?
    { value: rank, msg: `${sourceKey}`, exact: exact, score: score } :
    { value: "Misc", msg: `Ranked as ${rank} in ${sourceKey}`, exact: exact, score: score };

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

  await cache.set(key, rank);
  return rank;
}
