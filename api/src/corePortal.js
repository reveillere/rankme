import fetch from 'node-fetch';
import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';
import NodeCache from 'node-cache';
import { levenshtein } from './levenshtein.js';  

export const BASE = 'http://portal.core.edu.au/conf-ranks';
export const querySource = '?search=&by=all&do=Export&source=';

// TTL = 1 days, checkperiod = 1 hour
const coreDB = new NodeCache({ stdTTL: 60 * 60 * 24 * 1, checkperiod: 60 * 60 });
const RANKS = [ 'A*', 'A', 'B', 'C' ];


async function getSources() {
  const sources = coreDB.get('sources');
  if (sources == undefined) {
    // cache miss
    const resp = await fetch(BASE);
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
  coreDB.set('sources', data);
  return data;
  } 
  return sources;
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
  const key = `source:${id}`
  const source = coreDB.get(key); 
  if (source == undefined) {
    // cache miss
    const resp = await fetch(`${BASE}/?search=&by=all&do=Export&source=${id}`);
    const text = await resp.text();
    const data = await parseRankSource(text);
    coreDB.set(key, data);
    return data;
  } 
  return source;
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
      acronym: item.acronym,
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

  const rank = await getRank(acronym, title, year);
  res.json(rank);
}



async function getRank(acronym, title, year) {  

  const key = `rank:${acronym}:${title}:${year}`
  let rank = coreDB.get(key); 
  if (rank != undefined) {
    // cache hit
    return rank;
  }

  // cache miss
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
    rank = { value: "Unranked", msg: `No ranking found in ${sourceKey}` };
  } else if (candidates.length > 1) {
    let scores = candidates.map(conf => ({ conf: conf, score: levenshtein(conf.title, title) }));
    let bestMatch = scores.reduce((min, current) => current.score < min.score ? current : min, scores[0]);
    rank = sanitizedRank(bestMatch.conf.rank, false, bestMatch.score);
  } else {
    const entry = candidates[0];
    const score = levenshtein(entry.title, title);
    rank = sanitizedRank(entry.rank, true, score);
  } 

  coreDB.set(key, rank);
  return rank;
}
