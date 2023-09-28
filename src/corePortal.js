import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';

// const core = 'http://localhost:3000/core/conf-ranks/'
// const portalAll = core + "?search=&by=all&source=all&do=Export";

// export async function load() {
//     try {
//         const resp = await fetch(portalAll);
//         if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
        
//         const txt = await resp.text();
//         const headers = ['id', 'title', 'acronym', 'source', 'rank', 'm1', 'm2', 'm3', 'm4'];
        
//         const results = await Papa.parse(txt, {
//             header: true,
//             beforeFirstChunk: function (chunk) {
//                 const rows = chunk.split(/\r\n|\r|\n/);
//                 rows.unshift(headers.join());
//                 return rows.join('\r\n');
//             }
//         });
        
//         return results.data;
//     } catch (e) {
//         console.error('Fetch Error: ', e);
//         throw e;
//     }
// }



// export async function rank(id, year) {
//     try {
//         const resp = await fetch(core + id);
//         if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
        
//         const txt = await resp.text();
//     } catch (e) {
//         console.error('Fetch Error: ', e);
//         throw e; 
//     }
// }

const local = 'http://localhost:3000/core/conf-ranks/';
const core = 'http://portal.core.edu.au/conf-ranks/';

const base = local;

export async function loadPage(query) {
    try {
        const resp = await fetch(base + query);
        if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
        const txt = await resp.text();
        return txt;
        
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
    return foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
}


async function load() {
    try {
        const main = await loadPage('/');
        const dom = HTMLParser.parse(main);
        const options = dom.querySelectorAll('select[name=source] option');
        const sources = extractSources(options.map(o => o.rawText));
        await Promise.all(sources.map(async item => {
            const rankRaw = await loadPage('?search=&by=all&do=Export&source=' + item.source);
            const rankJSON = await parseRankSource(rankRaw);
            item.ranks = rankJSON;
        }));
        return sources;
    } catch (e) {
        console.error('Error calling rank function:', e);
    }
}

export default {
    load,
    findSourceForYear
}