import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';


const coreURL = 'http://localhost:3000/core';


export const ranks = [ 'A*', 'A', 'B', 'C', 'Unranked', 'Multi' ];


export async function loadPage(query) {
    try {
        const resp = await fetch(query);
        if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
        const text = await resp.text();
        return text;
    } catch (e) {
        console.error('Fetch Error: ', e);
        throw e; 
    }   
}

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
        
        return results.data;
    } catch (e) {
        console.error('Fetch Error: ', e);
        throw e;
    }
}


function extractSources(list) {
    const result = [];
    const yearRegex = /\d+/g; // Regular expression to match four-digit numbers
    
    list.forEach(item => {
        const trimmedItem = item.trim(); // Remove leading and trailing whitespaces
        if (trimmedItem === 'All') return; // Skip the special case of 'All'
        
        const matches = trimmedItem.match(yearRegex) || [];
        matches.forEach(match => {
            if (match.length === 4) { // Only consider sequences of four digits
                result.push({
                    year: parseInt(match, 10), // Convert string to number
                    source: trimmedItem
                });
            }
        });
    });    
    return result;
}
 

function findSourceForYear(list, year) {
    const sortedList = list.sort((a, b) => b.year - a.year);
    const foundItem = sortedList.find(item => item.year <= year);
    const found = foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
    return found;
}


async function load() {
    try {
        const main = await loadPage(`${coreURL}/sources`);
        const dom = HTMLParser.parse(main);
        const options = dom.querySelectorAll('select[name=source] option');
        const sources = extractSources(options.map(o => o.rawText));

        const promises = sources.map(async item => {
            try {
                const rankRaw = await loadPage(`${coreURL}/source/${item.source}`);
                item.ranks = await parseRankSource(rankRaw);
            } catch (e) {
                console.error('Error loading and parsing rank for source:', item.source, e);
            }
        });

        await Promise.all(promises);

        return sources;
    } catch (e) {
        console.error('Error calling load function:', e);
    }
}






async function rank(coreRanks, publication) {
    try {
        const acronym = publication?.dblp?.booktitle;
        if (!acronym) return "Unranked"; 

        const rankingSource = findSourceForYear(coreRanks, publication.dblp.year);

        const ranking = coreRanks.find(rank => rank.source === rankingSource)?.ranks;
        if (!ranking) return "Unranked"; 

        const candidates = ranking.filter(conf => conf.acronym === acronym);
        if (candidates.length === 0) return "Unranked";
        if (candidates.length > 1) return "Multi";

        const entry = candidates[0];
        return ranks.includes(entry.rank) ? entry.rank : "?";
    } catch (error) {
        console.error('Error in rank function:', error);
        return "Error"; 
    }
}


export default {
    load,
    rank,
    ranks,
    findSourceForYear
}